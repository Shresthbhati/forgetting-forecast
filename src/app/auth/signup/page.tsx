'use client';

import { Suspense } from 'react';
import { SignUpForm } from '@/components/auth/AuthForms';
import { AuthLayout } from '@/components/auth/AuthLayout';

export default function SignUpPage() {
  return (
    <AuthLayout title="NEW_USER.EXE">
      <Suspense fallback={null}>
        <SignUpForm />
      </Suspense>
    </AuthLayout>
  );
}
