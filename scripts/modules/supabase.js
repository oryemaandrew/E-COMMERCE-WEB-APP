import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Replace these placeholders with your actual Supabase Project details
const SUPABASE_URL = 'https://hxuzkwittfotrdyuvglv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4dXprd2l0dGZvdHJkeXV2Z2x2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTk5ODMsImV4cCI6MjEwNDA3NTk4M30.rjVZekL5EyOCfvBHqV6PKu1HIY3pgj9soTQ80pgKjVM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);