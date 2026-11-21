import { useNavigate } from 'react-router';
import { useT } from '@/i18n';
import { Screen } from '@/ui/kit';

export function CustomPage() {
  const t = useT();
  const nav = useNavigate();
  return <Screen title={t('custom.title')} onBack={() => nav('/')}>…</Screen>;
}

export function ImportPage() {
  return null;
}
