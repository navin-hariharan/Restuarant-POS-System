import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import { AppProviders } from '@/providers/AppProviders';
import { ConfirmProvider } from '@/components/ui';
import { router } from '@/routes';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </AppProviders>
  </React.StrictMode>,
);
