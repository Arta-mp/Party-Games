import { LazyMotion, MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { useIdentity } from '@/core/identity/store';
import { useLang } from '@/i18n';
import { useSettings } from './settings';
import { Home } from './pages/Home';
import { NamePage } from './pages/Name';
import { Tutorial } from './Tutorial';

// route-level code splitting: the home screen stays light; networking/zod/etc. load with the lobby
const loadFeatures = () => import('./motion-features').then((m) => m.default);
const JoinPage = lazy(() => import('./pages/Lobby').then((m) => ({ default: m.JoinPage })));
const LobbyPage = lazy(() => import('./pages/Lobby').then((m) => ({ default: m.LobbyPage })));
const LocalSetup = lazy(() => import('./pages/Local').then((m) => ({ default: m.LocalSetup })));
const LocalPlay = lazy(() => import('./pages/Local').then((m) => ({ default: m.LocalPlay })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

const CustomPage = lazy(() => import('./pages/Custom').then((m) => ({ default: m.CustomPage })));
const ImportPage = lazy(() => import('./pages/Custom').then((m) => ({ default: m.ImportPage })));

function RequireName({ children }: { children: ReactNode }) {
  const name = useIdentity((s) => s.name);
  const loc = useLocation();
  if (!name) return <Navigate to={`/name?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return (
    <>
      {children}
      <Tutorial />
    </>
  );
}

function Shell() {
  const theme = useSettings((s) => s.theme);
  const lang = useLang();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.lang = lang;
    root.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#12101a' : '#f7f5fb');
  }, [theme, lang]);
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-muted">…</div>}>
      <Routes>
        <Route path="/name" element={<NamePage />} />
        <Route path="/" element={<RequireName><Home /></RequireName>} />
        <Route path="/join/:code" element={<RequireName><JoinPage /></RequireName>} />
        <Route path="/lobby/:code" element={<RequireName><LobbyPage /></RequireName>} />
        <Route path="/local" element={<RequireName><LocalSetup /></RequireName>} />
        <Route path="/local/play" element={<RequireName><LocalPlay /></RequireName>} />
        <Route path="/settings" element={<RequireName><SettingsPage /></RequireName>} />
        <Route path="/custom" element={<RequireName><CustomPage /></RequireName>} />
        <Route path="/import/:data" element={<RequireName><ImportPage /></RequireName>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <HashRouter>
          <Shell />
        </HashRouter>
      </MotionConfig>
    </LazyMotion>
  );
}
