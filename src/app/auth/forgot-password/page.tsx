'use client';

import { ForgotPasswordForm } from '@/components/auth/AuthForms';
import { AuthLayout } from '@/components/auth/AuthLayout';

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="RESET.EXE">
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
