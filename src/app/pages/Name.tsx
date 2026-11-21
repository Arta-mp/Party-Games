import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useIdentity } from '@/core/identity/store';
import { cleanName, validateName } from '@/core/identity/identity';
import { useT } from '@/i18n';
import { Avatar, Button, Screen, TextField } from '@/ui/kit';

export function NamePage() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const current = useIdentity((s) => s.name);
  const setName = useIdentity((s) => s.setName);
  const [value, setValue] = useState(current ?? '');
  const status = validateName(value);
  const next = params.get('next') || '/';
  return (
    <Screen title={current ? t('name.change') : undefined} onBack={current ? () => nav(-1) : undefined}>
      <form
        className="flex flex-1 flex-col items-center justify-center gap-6 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (setName(value)) nav(next, { replace: true });
        }}
      >
        <span className="text-6xl">👋</span>
        <h1 className="text-3xl font-black">{t('name.title')}</h1>
        <p className="text-muted max-w-xs text-sm">{t('name.subtitle')}</p>
        <Avatar name={cleanName(value) || '?'} size={88} />
        <div className="w-full">
          <TextField
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={20}
            autoFocus
            placeholder={t('name.placeholder')}
            className="text-center text-2xl"
            hint={value && status !== 'ok' ? t(`name.err.${status}`) : t('name.hint')}
            data-testid="name-input"
            aria-label={t('name.title')}
          />
        </div>
        <Button type="submit" size="xl" block disabled={status !== 'ok'} data-testid="name-save">
          {t('name.save')}
        </Button>
      </form>
    </Screen>
  );
}
