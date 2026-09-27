// scripts/modules/contact.js
import { supabase } from './supabase.js';

export function initContactForm() {
  const form = document.getElementById('corporateContactForm');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Sending... ⏳';

      const formData = new FormData(form);

      try {
        const response = await fetch('https://formspree.io/f/xbgjojgr', {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          alert('Thank you! Your message has been sent successfully to the VENDORA team.');
          form.reset();
        } else {
          alert('Oops! There was a problem submitting your form.');
        }
      } catch (error) {
        alert('Connection error. Please check your network and try again.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });
  }
}

export function initCustomerRequestForm() {
  const form = document.getElementById('customerOrderRequestForm');
  const status = document.getElementById('customerRequestStatus');
  if (!form || !status) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    const customerName = document.getElementById('customerName')?.value.trim();
    const phone = document.getElementById('customerPhone')?.value.trim();
    const itemName = document.getElementById('customerOrderItem')?.value.trim();
    const notes = document.getElementById('customerOrderNotes')?.value.trim();

    if (!customerName || !phone || !itemName) {
      status.style.display = 'block';
      status.textContent = 'Please complete the required fields.';
      return;
    }

    submitButton.disabled = true;
    const request = {
      customer_name: customerName,
      phone,
      item_name: itemName,
      notes,
      source: 'online',
      status: 'pending',
      assigned_cashier: 'Unassigned'
    };

    try {
      const { error } = await supabase.from('customer_requests').insert(request);
      if (error) throw error;

      status.style.display = 'block';
      status.style.background = 'rgba(16, 185, 129, 0.15)';
      status.style.color = '#10b981';
      status.style.border = '1px solid #10b981';
      status.textContent = 'Your order request has been sent to the cashier queue.';
      form.reset();
    } catch (error) {
      console.error('Customer request submission error:', error);
      status.style.display = 'block';
      status.style.background = 'rgba(239, 68, 68, 0.15)';
      status.style.color = '#ef4444';
      status.style.border = '1px solid #ef4444';
      status.textContent = 'The request could not be sent. Please try again.';
    } finally {
      submitButton.disabled = false;
    }
  });
}