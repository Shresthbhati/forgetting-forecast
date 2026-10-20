'use client';

import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/AuthForms';
import { AuthLayout } from '@/components/auth/AuthLayout';

export default function SignInPage() {
  return (
    <AuthLayout title="LOGIN.EXE">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </AuthLayout>
  );
}
