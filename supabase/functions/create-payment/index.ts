import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function normalisePhone(phone: string) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('256') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `256${digits.slice(1)}`;
  throw new Error('Enter a valid Uganda phone number.');
}

function providerError(responseBody: unknown) {
  if (typeof responseBody === 'string') return responseBody.slice(0, 300);
  return JSON.stringify(responseBody).slice(0, 300);
}

async function requestMtnPayment(orderId: number, amount: number, phone: string) {
  const baseUrl = Deno.env.get('MTN_BASE_URL');
  const subscriptionKey = Deno.env.get('MTN_SUBSCRIPTION_KEY');
  const apiUser = Deno.env.get('MTN_API_USER');
  const apiKey = Deno.env.get('MTN_API_KEY');
  const targetEnvironment = Deno.env.get('MTN_TARGET_ENVIRONMENT') ?? 'sandbox';

  if (!baseUrl || !subscriptionKey || !apiUser || !apiKey) {
    throw new Error('MTN payment is not configured on the server.');
  }

  const tokenResponse = await fetch(`${baseUrl}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${apiUser}:${apiKey}`)}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey
    }
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(`MTN authentication failed: ${providerError(tokenBody)}`);
  }

  const referenceId = crypto.randomUUID();
  const paymentResponse = await fetch(`${baseUrl}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': targetEnvironment,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: String(amount),
      currency: 'UGX',
      externalId: String(orderId),
      payer: { partyIdType: 'MSISDN', partyId: phone },
      payerMessage: `VENDORA order ${orderId}`,
      payeeNote: 'VENDORA order payment'
    })
  });

  if (!paymentResponse.ok) {
    throw new Error(`MTN payment request failed: ${providerError(await paymentResponse.text())}`);
  }

  return { providerTransactionId: referenceId, providerReference: referenceId };
}

async function requestAirtelPayment(orderId: number, amount: number, phone: string) {
  const baseUrl = Deno.env.get('AIRTEL_BASE_URL');
  const clientId = Deno.env.get('AIRTEL_CLIENT_ID');
  const clientSecret = Deno.env.get('AIRTEL_CLIENT_SECRET');

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('Airtel payment is not configured on the server.');
  }

  const tokenResponse = await fetch(`${baseUrl}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(`Airtel authentication failed: ${providerError(tokenBody)}`);
  }

  const reference = `VENDORA-${orderId}-${crypto.randomUUID()}`;
  const paymentResponse = await fetch(`${baseUrl}/merchant/v1/payments/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      reference,
      subscriber: { country: 'UG', currency: 'UGX', msisdn: phone.slice(3) },
      transaction: { amount, country: 'UG', currency: 'UGX', id: reference }
    })
  });

  if (!paymentResponse.ok) {
    throw new Error(`Airtel payment request failed: ${providerError(await paymentResponse.text())}`);
  }

  const paymentBody = await paymentResponse.json().catch(() => ({}));
  return {
    providerTransactionId: paymentBody?.data?.transaction?.id ?? reference,
    providerReference: reference
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let transactionId: string | null = null;

  try {
    const body = await request.json();
    const orderId = Number(body.orderId);
    const provider = String(body.provider ?? '').toLowerCase();
    const phone = normalisePhone(String(body.phone ?? ''));

    if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('A valid orderId is required.');
    if (provider !== 'mtn' && provider !== 'airtel') throw new Error('Provider must be mtn or airtel.');

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, total_amount, status')
      .eq('id', orderId)
      .single();
    if (orderError || !order) throw new Error('Order was not found.');
    if (['paid', 'completed'].includes(order.status)) throw new Error('This order is already paid.');

    const amount = Number(order.total_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Order amount is invalid.');

    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        order_id: order.id,
        provider,
        customer_phone: phone,
        amount,
        status: 'pending'
      })
      .select('id')
      .single();
    if (transactionError || !transaction) {
      console.error('Failed to create payment transaction record:', transactionError);
      return json({ error: 'Failed to record transaction' }, 500);
    }
    transactionId = transaction.id;

    const providerResult = provider === 'mtn'
      ? await requestMtnPayment(order.id, amount, phone)
      : await requestAirtelPayment(order.id, amount, phone);

    const { error: providerReferenceError } = await supabaseAdmin.from('payment_transactions').update({
      provider_transaction_id: providerResult.providerTransactionId,
      provider_reference: providerResult.providerReference
    }).eq('id', transactionId);
    if (providerReferenceError) {
      console.error('Failed to update payment transaction record:', providerReferenceError);
      return json({ error: 'Failed to record provider transaction' }, 500);
    }

    const { error: orderUpdateError } = await supabaseAdmin.from('orders').update({
      payment_method: provider === 'mtn' ? 'MTN MoMo' : 'Airtel Money',
      status: 'awaiting_payment',
      customer_phone: phone
    }).eq('id', order.id);
    if (orderUpdateError) {
      console.error('Failed to update order status:', orderUpdateError);
      return json({ error: 'Failed to update order status' }, 500);
    }

    return json({
      ok: true,
      transactionId,
      status: 'awaiting_payment',
      message: 'Payment prompt sent. Approve it on your phone.'
    });
  } catch (error) {
    if (transactionId) {
      const { error: failureUpdateError } = await supabaseAdmin.from('payment_transactions').update({
        status: 'failed',
        failure_reason: error instanceof Error ? error.message : 'Payment request failed.'
      }).eq('id', transactionId);
      if (failureUpdateError) {
        console.error('Failed to mark payment transaction as failed:', failureUpdateError);
      }
    }

    return json({
      error: error instanceof Error ? error.message : 'Payment request failed.'
    }, 400);
  }
});
