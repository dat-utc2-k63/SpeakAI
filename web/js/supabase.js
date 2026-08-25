// ============================================================
// Supabase Client Initialization
// Thay thế SUPABASE_URL và SUPABASE_ANON_KEY bằng thông tin
// thật từ Supabase project của bạn.
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://kngkckshvgaqeiatryqy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuZ2tja3NodmdhcWVpYXRyeXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MzAxMjYsImV4cCI6MjEwMzEwNjEyNn0.tDs7-9R0h3YHQF78uGGMSWtUXTOOE5y0XYD5mYk_KAM';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
