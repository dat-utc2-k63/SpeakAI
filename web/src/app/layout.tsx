import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ToastProvider';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SpeakAI – Hệ thống Luyện nói & Đánh giá Tiếng Anh với AI',
  description:
    'Nền tảng luyện nói tiếng Anh trực tuyến với AI: chấm phát âm, góp ý ngữ pháp, đánh giá hội thoại 1-1 và phân tích giờ dạy.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f8fafc',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={inter.variable} suppressHydrationWarning>
      <body
        className="min-h-dvh bg-slate-50 text-slate-900 antialiased selection:bg-blue-100 selection:text-blue-900"
        suppressHydrationWarning
      >
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
