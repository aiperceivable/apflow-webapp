import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { MantineProvider, ColorSchemeScript } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';
import { AppShellWrapper } from '@/components/layout/AppShell';
import { I18nProvider } from '@/lib/i18n/provider';
import { QueryProvider } from '@/lib/providers/QueryProvider';
import { AutoLoginProvider } from '@/lib/contexts/AutoLoginContext';
import { themeConfig } from '@/lib/theme/config';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "APFlow - Task Management",
  description: "Web application for managing and executing tasks with apflow",
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
      </head>
      <body className={inter.className}>
        <QueryProvider>
          <I18nProvider>
            <MantineProvider theme={themeConfig} defaultColorScheme="auto">
              <DatesProvider settings={{}}>
                <AutoLoginProvider>
                  <Notifications position="bottom-right" />
                  <AppShellWrapper>
                    {children}
                  </AppShellWrapper>
                </AutoLoginProvider>
              </DatesProvider>
            </MantineProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
