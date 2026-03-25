import { EB_Garamond, Montserrat } from 'next/font/google';

// Serif font for headings (EB Garamond)
export const serifFont = EB_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-heading',
  display: 'swap',
});

// Sans-serif font for body text (Montserrat)
export const sansFont = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});
