import { notFound } from 'next/navigation';
import { UiGallery } from './UiGallery';

export const metadata = { title: 'UI QA Sheet — Forgetting Forecast' };

export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UiGallery />;
}
