import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Pack, PackKind } from '@/content/schema';
import { itemToLine, PACK_KINDS, parsePackText, slugId } from '@/custom/packText';
import {
  abilityRoleSchema,
  DEFAULT_PRIORITY,
  infoRoleSchema,
  NIGHT_ACTIONS,
  PASSIVES,
  TARGETS,
  type AbilityRole,
  type AbilityRoleInput,
  type InfoRole,
} from '@/custom/schemas';
import { parseImport, shareLink, type SharePayload } from '@/custom/share';
import { useCustom } from '@/custom/store';
import { useNum, useT } from '@/i18n';
import { cn } from '@/ui/cn';
import {
  Badge,
  Button,
  Card,
  Empty,
  Notice,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  Stepper,
  TextField,
  Toggle,
} from '@/ui/kit';

type Tab = 'ability' | 'info' | 'packs' | 'share';

async function copyOrShare(url: string, title: string) {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const { label, className, ...rest } = props;
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-muted text-sm font-bold">{label}</span>}
      <textarea
        className={cn(
          'border-border bg-surface-2 focus:border-accent min-h-40 rounded-2xl border p-3 text-base leading-8 outline-none',
          className,
        )}
        {...rest}
      />
    </label>
  );
}

// ------------------------------------------------------------------ ability role editor (§7.4 step-by-step)

const EMOJIS = [
  '🎭',
  '🔫',
  '🩺',
  '🔎',
  '🎯',
  '🛡️',
  '🤐',
  '🤡',
  '🐺',
  '🔮',
  '🧪',
  '🏹',
  '👑',
  '🧛',
  '🕵️',
  '💣',
  '🦹',
  '👼',
];

const emptyAbility = (): AbilityRoleInput => ({
  id: slugId('role'),
  nameFa: '',
  emoji: '🎭',
  team: 'citizens',
  night: null,
  passive: [],
  weight: 1,
  descriptionFa: '',
});

export function AbilityRoleCard({ role }: { role: AbilityRole }) {
  const t = useT();
  return (
    <Card
      className="border-accent/40 flex flex-col items-center gap-2 text-center"
      data-testid="role-preview"
    >
      <span className="text-5xl">{role.emoji}</span>
      <b className="text-2xl">{role.nameFa || '—'}</b>
      <Badge>{t(`mafia.team.${role.team}`)}</Badge>
      {role.night.map((ab, i) => (
        <span key={i} className="text-sm">
          🌙 {t(`mafia.action.${ab.action}`)} · {t(`custom.target.${ab.target}`)}
          {ab.uses != null && ` · ${t('mafia.usesLeft', { n: ab.uses })}`}
          {ab.fromNight > 1 && ` · ${t('custom.fromNight', { n: ab.fromNight })}`}
          {ab.shared && ` · ${t('custom.shared')}`}
        </span>
      ))}
      {role.passive.length > 0 && (
        <span className="text-muted text-xs">
          {role.passive.map((p) => t(`custom.passive.${p}`)).join(' · ')}
        </span>
      )}
      <p className="text-muted text-xs">{role.descriptionFa}</p>
      <Badge>{t('custom.weight', { n: role.weight })}</Badge>
    </Card>
  );
}

function AbilityRoleEditor({ initial, onDone }: { initial: AbilityRoleInput | null; onDone: () => void }) {
  const t = useT();
  const save = useCustom((s) => s.saveAbilityRole);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AbilityRoleInput>(initial ?? emptyAbility());
  const parsed = abilityRoleSchema.safeParse(draft);
  const ability = Array.isArray(draft.night) ? draft.night[0] : draft.night;
  const setAbility = (patch: Record<string, unknown> | null) =>
    setDraft({
      ...draft,
      night: patch === null ? null : { action: 'kill', target: 'other', ...(ability ?? {}), ...patch },
    });
  const steps = [
    'custom.step.name',
    'custom.step.team',
    'custom.step.ability',
    'custom.step.win',
    'custom.step.preview',
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="role-editor">
      <div className="flex gap-1" aria-label="steps">
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={cn('h-2 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-border')}
            aria-label={t(s)}
          />
        ))}
      </div>
      <h3 className="font-black">{t(steps[step]!)}</h3>
      {step === 0 && (
        <>
          <TextField
            label={t('custom.name')}
            value={draft.nameFa}
            onChange={(e) => setDraft({ ...draft, nameFa: e.target.value })}
            maxLength={32}
            data-testid="role-name-input"
          />
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setDraft({ ...draft, emoji: e })}
                className={cn(
                  'size-12 rounded-xl text-2xl',
                  draft.emoji === e ? 'bg-accent/30 ring-accent ring-2' : 'bg-surface-2',
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
      {step === 1 && (
        <Segmented
          value={draft.team}
          onChange={(team) =>
            setDraft({ ...draft, team, knowsTeammates: team === 'mafia' ? true : draft.knowsTeammates })
          }
          options={(['citizens', 'mafia', 'neutral'] as const).map((v) => ({
            value: v,
            label: t(`mafia.team.${v}`),
          }))}
        />
      )}
      {step === 2 && (
        <>
          <Toggle
            label={t('custom.hasNight')}
            checked={!!ability}
            onChange={(on) => setAbility(on ? {} : null)}
          />
          {ability && (
            <>
              {[0, 4, 8].map((from) => (
                <Segmented
                  key={from}
                  value={ability.action}
                  onChange={(action) =>
                    setAbility({
                      action,
                      priority: DEFAULT_PRIORITY[action],
                      ...(action === 'revive' ? { target: 'dead' } : {}),
                      targets: action === 'predict' ? 3 : 1,
                    })
                  }
                  options={NIGHT_ACTIONS.slice(from, from + 4).map((a) => ({
                    value: a,
                    label: t(`mafia.action.${a}`),
                  }))}
                />
              ))}
              {[0, 3].map((from) => (
                <Segmented
                  key={from}
                  label={from === 0 ? t('custom.target') : undefined}
                  value={ability.target ?? 'other'}
                  onChange={(target) => setAbility({ target })}
                  options={TARGETS.slice(from, from + 3).map((x) => ({
                    value: x,
                    label: t(`custom.target.${x}`),
                  }))}
                />
              ))}
              {ability.action === 'predict' && (
                <Stepper
                  label={t('custom.targetsCount')}
                  value={ability.targets ?? 1}
                  min={1}
                  max={3}
                  onChange={(targets) => setAbility({ targets })}
                />
              )}
              {ability.action === 'arm' && (
                <Toggle
                  label={t('custom.fakeGun')}
                  checked={!!ability.fake}
                  onChange={(fake) => setAbility({ fake })}
                />
              )}
              <Stepper
                label={t('custom.every')}
                value={ability.every ?? 1}
                min={1}
                max={4}
                onChange={(every) => setAbility({ every })}
              />
              <Stepper
                label={t('custom.uses')}
                value={ability.uses ?? 0}
                min={0}
                max={10}
                format={(v) => (v === 0 ? '∞' : String(v))}
                onChange={(v) => setAbility({ uses: v === 0 ? null : v })}
              />
              <Stepper
                label={t('custom.fromNightLabel')}
                value={ability.fromNight ?? 1}
                min={1}
                max={5}
                onChange={(fromNight) => setAbility({ fromNight })}
              />
              <Stepper
                label={t('custom.priority')}
                value={ability.priority ?? DEFAULT_PRIORITY[ability.action]}
                min={0}
                max={100}
                step={5}
                onChange={(priority) => setAbility({ priority })}
              />
              {draft.team !== 'citizens' && (
                <Toggle
                  label={t('custom.shared')}
                  hint={t('custom.sharedHint')}
                  checked={!!ability.shared}
                  onChange={(shared) => setAbility({ shared })}
                />
              )}
            </>
          )}
          <SectionTitle>{t('custom.passives')}</SectionTitle>
          {PASSIVES.map((p) => (
            <Toggle
              key={p}
              label={t(`custom.passive.${p}`)}
              checked={draft.passive?.includes(p) ?? false}
              onChange={(on) =>
                setDraft({
                  ...draft,
                  passive: on ? [...(draft.passive ?? []), p] : (draft.passive ?? []).filter((x) => x !== p),
                })
              }
            />
          ))}
        </>
      )}
      {step === 3 && (
        <>
          {draft.team === 'neutral' && (
            <Segmented
              label={t('custom.winCondition')}
              value={draft.winCondition ?? 'team'}
              onChange={(winCondition) => setDraft({ ...draft, winCondition })}
              options={(['survive', 'lynched', 'lastStanding'] as const).map((v) => ({
                value: v,
                label: t(`custom.win.${v}`),
              }))}
            />
          )}
          {draft.team === 'mafia' && (
            <Stepper
              label={t('custom.rank')}
              value={draft.rank ?? 0}
              min={0}
              max={5}
              onChange={(rank) => setDraft({ ...draft, rank })}
            />
          )}
          <Toggle
            label={t('custom.knowsTeammates')}
            checked={!!draft.knowsTeammates}
            onChange={(knowsTeammates) => setDraft({ ...draft, knowsTeammates })}
          />
          <Toggle
            label={t('custom.wrongKill')}
            checked={draft.onWrongKill === 'selfDies'}
            onChange={(on) => setDraft({ ...draft, onWrongKill: on ? 'selfDies' : 'none' })}
          />
          <Stepper
            label={t('custom.weightLabel')}
            value={draft.weight ?? 0}
            min={-10}
            max={10}
            onChange={(weight) => setDraft({ ...draft, weight })}
          />
          <TextArea
            label={t('custom.description')}
            value={draft.descriptionFa ?? ''}
            onChange={(e) => setDraft({ ...draft, descriptionFa: e.target.value })}
            maxLength={200}
            className="min-h-24"
          />
        </>
      )}
      {step === 4 &&
        (parsed.success ? (
          <AbilityRoleCard role={parsed.data} />
        ) : (
          <Notice tone="danger">
            {parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')}
          </Notice>
        ))}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => (step === 0 ? onDone() : setStep(step - 1))}>
          {step === 0 ? t('common.cancel') : t('common.prev')}
        </Button>
        {step < 4 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={step === 0 && !draft.nameFa.trim()}
            data-testid="role-next"
          >
            {t('common.next')}
          </Button>
        ) : (
          <Button
            disabled={!parsed.success}
            onClick={() => {
              if (parsed.success) {
                save(parsed.data);
                onDone();
              }
            }}
            data-testid="role-save"
          >
            {t('common.save')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ info role editor (§7.2)

function InfoRoleEditor({ initial, onDone }: { initial: InfoRole | null; onDone: () => void }) {
  const t = useT();
  const save = useCustom((s) => s.saveInfoRole);
  const saved = useCustom((s) => s.infoRoles);
  const [draft, setDraft] = useState<InfoRole>(
    initial ?? infoRoleSchema.parse({ id: slugId('info'), nameFa: '', team: 'citizens', sees: 'secret' }),
  );
  const parsed = infoRoleSchema.safeParse(draft);
  const knowable = ['spy', 'citizen', 'infiltrator', 'blank', 'witness', ...saved.map((r) => r.id)].filter(
    (x) => x !== draft.id,
  );
  return (
    <div className="flex flex-col gap-3" data-testid="info-editor">
      <TextField
        label={t('custom.name')}
        value={draft.nameFa}
        onChange={(e) => setDraft({ ...draft, nameFa: e.target.value })}
        maxLength={32}
      />
      <div className="flex flex-wrap gap-2">
        {EMOJIS.slice(0, 10).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setDraft({ ...draft, emoji: e })}
            className={cn(
              'size-11 rounded-xl text-xl',
              draft.emoji === e ? 'bg-accent/30 ring-accent ring-2' : 'bg-surface-2',
            )}
          >
            {e}
          </button>
        ))}
      </div>
      <Segmented
        label={t('custom.info.team')}
        value={draft.team}
        onChange={(team) => setDraft({ ...draft, team })}
        options={[
          { value: 'citizens', label: t('custom.info.citizens') },
          { value: 'spies', label: t('custom.info.spies') },
        ]}
      />
      <Segmented
        label={t('custom.info.sees')}
        value={draft.sees}
        onChange={(sees) => setDraft({ ...draft, sees })}
        options={(['secret', 'similar', 'category', 'none'] as const).map((v) => ({
          value: v,
          label: t(`custom.sees.${v}`),
        }))}
      />
      <span className="text-muted text-sm font-bold">{t('custom.info.knows')}</span>
      <div className="flex flex-wrap gap-2">
        {knowable.map((k) => {
          const on = draft.knows.includes(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setDraft({ ...draft, knows: on ? draft.knows.filter((x) => x !== k) : [...draft.knows, k] })
              }
              className={cn(
                'h-10 rounded-full border px-3 text-sm',
                on ? 'border-accent bg-accent/20' : 'border-border',
              )}
            >
              {saved.find((r) => r.id === k)?.nameFa ?? t(`custom.known.${k}`)}
            </button>
          );
        })}
      </div>
      <Segmented
        label={t('custom.info.onElim')}
        value={draft.onEliminated}
        onChange={(onEliminated) => setDraft({ ...draft, onEliminated })}
        options={(['none', 'guessSecret', 'spyGuessesWitness'] as const).map((v) => ({
          value: v,
          label: t(`custom.elim.${v}`),
        }))}
      />
      <Toggle
        label={t('custom.info.selfAware')}
        checked={draft.selfAware}
        onChange={(selfAware) => setDraft({ ...draft, selfAware })}
      />
      <Toggle
        label={t('custom.info.solo')}
        checked={draft.win === 'solo'}
        onChange={(on) => setDraft({ ...draft, win: on ? 'solo' : 'team' })}
      />
      <Stepper
        label={t('custom.info.max')}
        value={draft.count.max}
        min={1}
        max={4}
        onChange={(max) => setDraft({ ...draft, count: { ...draft.count, max } })}
      />
      <TextArea
        label={t('custom.description')}
        value={draft.descriptionFa}
        onChange={(e) => setDraft({ ...draft, descriptionFa: e.target.value })}
        maxLength={200}
        className="min-h-20"
      />
      {!parsed.success && draft.nameFa && <Notice tone="danger">{parsed.error.issues[0]?.message}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={!parsed.success || !draft.nameFa.trim()}
          onClick={() => parsed.success && (save(parsed.data), onDone())}
          data-testid="info-save"
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pack editor

function PackEditor({ initial, onDone }: { initial: Pack | null; onDone: () => void }) {
  const t = useT();
  const num = useNum();
  const save = useCustom((s) => s.savePack);
  const [kind, setKind] = useState<PackKind>(initial?.kind ?? 'words');
  const [nameFa, setName] = useState(initial?.nameFa ?? '');
  const [text, setText] = useState(
    initial
      ? (initial.items as Record<string, unknown>[]).map((i) => itemToLine(initial.kind, i)).join('\n')
      : '',
  );
  const id = useMemo(() => initial?.id ?? slugId('pack'), [initial]);
  const res = parsePackText({ id, nameFa: nameFa || '—', kind }, text);
  return (
    <div className="flex flex-col gap-3" data-testid="pack-editor">
      <TextField
        label={t('custom.packName')}
        value={nameFa}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        data-testid="pack-name"
      />
      {!initial && (
        <div className="flex flex-wrap gap-2">
          {PACK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === kind}
              onClick={() => setKind(k)}
              className={cn(
                'h-10 rounded-full border px-3 text-sm font-bold',
                k === kind ? 'border-accent bg-accent/20' : 'border-border text-muted',
              )}
              data-testid={`kind-${k}`}
            >
              {t(`custom.kind.${k}`)}
            </button>
          ))}
        </div>
      )}
      <Notice>{t(`custom.format.${kind}`)}</Notice>
      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t(`custom.format.${kind}`)}
        data-testid="pack-text"
      />
      <p className="text-muted text-xs">{t('custom.itemsCount', { n: num(res.pack?.items.length ?? 0) })}</p>
      {res.errors.slice(0, 5).map((e) => (
        <Notice key={e.line} tone="danger">
          {t('custom.lineError', { n: num(e.line) })} {e.message}
        </Notice>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={!res.pack || !nameFa.trim()}
          onClick={() => res.pack && (save({ ...res.pack, nameFa: nameFa.trim() }), onDone())}
          data-testid="pack-save"
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

function ItemRow({
  title,
  sub,
  onEdit,
  onShare,
  onDelete,
  testId,
}: {
  title: string;
  sub?: string;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
  testId?: string;
}) {
  const t = useT();
  return (
    <Card className="flex items-center gap-2 p-3" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <b className="block truncate">{title}</b>
        {sub && <span className="text-muted text-xs">{sub}</span>}
      </div>
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t('common.edit')}>
        ✏️
      </Button>
      <Button variant="ghost" size="icon" onClick={onShare} aria-label={t('custom.share')}>
        🔗
      </Button>
      <Button variant="ghost" size="icon" onClick={onDelete} aria-label={t('common.delete')}>
        🗑️
      </Button>
    </Card>
  );
}

export function CustomPage() {
  const t = useT();
  const num = useNum();
  const nav = useNavigate();
  const store = useCustom();
  const [tab, setTab] = useState<Tab>('ability');
  const [editing, setEditing] = useState<{ kind: Tab; item: unknown } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const share = async (p: Parameters<typeof shareLink>[0], title: string) => {
    const url = shareLink(p);
    const ok = await copyOrShare(url, title);
    setToast(ok ? t('custom.linkReady') : url);
  };
  const imported = importText ? parseImport(importText) : null;
  return (
    <Screen title={`✏️ ${t('custom.title')}`} onBack={() => nav('/')}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ability', label: t('custom.tab.ability') },
          { value: 'info', label: t('custom.tab.info') },
          { value: 'packs', label: t('custom.tab.packs') },
          { value: 'share', label: t('custom.tab.share') },
        ]}
      />
      {toast && <Notice tone="success">{toast}</Notice>}

      {tab === 'ability' && (
        <>
          <p className="text-muted text-sm leading-7">{t('custom.abilityIntro')}</p>
          <Button onClick={() => setEditing({ kind: 'ability', item: null })} data-testid="new-role">
            ➕ {t('custom.newRole')}
          </Button>
          {store.abilityRoles.length === 0 && <Empty>{t('custom.empty')}</Empty>}
          {store.abilityRoles.map((r) => (
            <ItemRow
              key={r.id}
              testId={`saved-role-${r.id}`}
              title={`${r.emoji} ${r.nameFa}`}
              sub={`${t(`mafia.team.${r.team}`)} · ${r.night.map((n) => t(`mafia.action.${n.action}`)).join('، ') || '—'}`}
              onEdit={() => setEditing({ kind: 'ability', item: r })}
              onShare={() => share({ v: 1, kind: 'ability-role', data: r }, r.nameFa)}
              onDelete={() => store.removeAbilityRole(r.id)}
            />
          ))}
        </>
      )}

      {tab === 'info' && (
        <>
          <p className="text-muted text-sm leading-7">{t('custom.infoIntro')}</p>
          <Button onClick={() => setEditing({ kind: 'info', item: null })} data-testid="new-info">
            ➕ {t('custom.newInfo')}
          </Button>
          {store.infoRoles.length === 0 && <Empty>{t('custom.empty')}</Empty>}
          {store.infoRoles.map((r) => (
            <ItemRow
              key={r.id}
              title={`${r.emoji} ${r.nameFa}`}
              sub={t(`custom.sees.${r.sees}`)}
              onEdit={() => setEditing({ kind: 'info', item: r })}
              onShare={() => share({ v: 1, kind: 'info-role', data: r }, r.nameFa)}
              onDelete={() => store.removeInfoRole(r.id)}
            />
          ))}
        </>
      )}

      {tab === 'packs' && (
        <>
          <p className="text-muted text-sm leading-7">{t('custom.packIntro')}</p>
          <Button onClick={() => setEditing({ kind: 'packs', item: null })} data-testid="new-pack">
            ➕ {t('custom.newPack')}
          </Button>
          {store.packs.length === 0 && <Empty>{t('custom.empty')}</Empty>}
          {store.packs.map((p) => (
            <ItemRow
              key={p.id}
              testId={`saved-pack-${p.id}`}
              title={p.nameFa}
              sub={`${t(`custom.kind.${p.kind}`)} · ${t('custom.itemsCount', { n: num(p.items.length) })}`}
              onEdit={() => setEditing({ kind: 'packs', item: p })}
              onShare={() => share({ v: 1, kind: 'pack', data: p }, p.nameFa)}
              onDelete={() => store.removePack(p.id)}
            />
          ))}
        </>
      )}

      {tab === 'share' && (
        <>
          <SectionTitle>{t('custom.exportAll')}</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                download('party-games-custom.json', {
                  v: 1,
                  kind: 'bundle',
                  data: { packs: store.packs, infoRoles: store.infoRoles, abilityRoles: store.abilityRoles },
                })
              }
            >
              ⬇️ JSON
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                share(
                  {
                    v: 1,
                    kind: 'bundle',
                    data: {
                      packs: store.packs,
                      infoRoles: store.infoRoles,
                      abilityRoles: store.abilityRoles,
                    },
                  },
                  t('custom.title'),
                )
              }
            >
              🔗 {t('custom.share')}
            </Button>
          </div>
          <SectionTitle>{t('custom.import')}</SectionTitle>
          <TextArea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t('custom.importHint')}
            data-testid="import-text"
          />
          <label className="text-muted text-sm">
            {t('custom.importFile')}{' '}
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setImportText(await f.text());
              }}
            />
          </label>
          {importText && !imported && <Notice tone="danger">{t('custom.importInvalid')}</Notice>}
          {imported && (
            <ImportPreview
              payload={imported}
              onDone={() => (setImportText(''), setToast(t('custom.imported')))}
            />
          )}
          <p className="text-muted text-xs leading-6">{t('custom.prHint')}</p>
        </>
      )}

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? t(`custom.edit.${editing.kind}`) : ''}
      >
        {editing?.kind === 'ability' && (
          <AbilityRoleEditor
            initial={editing.item as AbilityRoleInput | null}
            onDone={() => setEditing(null)}
          />
        )}
        {editing?.kind === 'info' && (
          <InfoRoleEditor initial={editing.item as InfoRole | null} onDone={() => setEditing(null)} />
        )}
        {editing?.kind === 'packs' && (
          <PackEditor initial={editing.item as Pack | null} onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </Screen>
  );
}

function ImportPreview({ payload, onDone }: { payload: SharePayload; onDone: () => void }) {
  const t = useT();
  const store = useCustom();
  const items =
    payload.kind === 'bundle'
      ? [
          ...payload.data.abilityRoles.map((r) => `${r.emoji} ${r.nameFa}`),
          ...payload.data.infoRoles.map((r) => `${r.emoji} ${r.nameFa}`),
          ...payload.data.packs.map((p) => `📦 ${p.nameFa}`),
        ]
      : payload.kind === 'pack'
        ? [`📦 ${payload.data.nameFa}`]
        : [`${payload.data.emoji} ${payload.data.nameFa}`];
  const apply = () => {
    if (payload.kind === 'pack') store.savePack(payload.data);
    if (payload.kind === 'info-role') store.saveInfoRole(payload.data);
    if (payload.kind === 'ability-role') store.saveAbilityRole(payload.data);
    if (payload.kind === 'bundle') {
      payload.data.packs.forEach(store.savePack);
      payload.data.infoRoles.forEach(store.saveInfoRole);
      payload.data.abilityRoles.forEach(store.saveAbilityRole);
    }
    onDone();
  };
  return (
    <Card className="flex flex-col gap-2" data-testid="import-preview">
      {payload.kind === 'ability-role' && <AbilityRoleCard role={payload.data} />}
      {payload.kind !== 'ability-role' && items.map((i) => <span key={i}>{i}</span>)}
      <Button onClick={apply} data-testid="import-save">
        ⬇️ {t('custom.addToMine')}
      </Button>
    </Card>
  );
}

export function ImportPage() {
  const t = useT();
  const nav = useNavigate();
  const { data = '' } = useParams();
  const payload = useMemo(() => parseImport(`#/import/${data}`), [data]);
  return (
    <Screen title={t('custom.import')} onBack={() => nav('/')}>
      {payload ? (
        <ImportPreview payload={payload} onDone={() => nav('/custom')} />
      ) : (
        <Notice tone="danger">{t('custom.importInvalid')}</Notice>
      )}
      <p className="text-muted ltr text-xs break-all">{data.slice(0, 40)}…</p>
    </Screen>
  );
}
