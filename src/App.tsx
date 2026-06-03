import { useEffect, useRef, useState } from "react";
import { Layout } from "./ui/Layout";
import { FileBrowser } from "./ui/FileBrowser";
import { SavedFloorplans } from "./ui/SavedFloorplans";
import { StoreyList } from "./ui/StoreyList";
import { EntityTypePicker } from "./ui/EntityTypePicker";
import { RenderOptionsPanel } from "./ui/RenderOptionsPanel";
import { StatusBar } from "./ui/StatusBar";
import { Toolbar } from "./ui/Toolbar";
import { PdfExportPanel } from "./ui/PdfExportPanel";
import { ViewerPane } from "./viewer/ViewerPane";
import { AreaList } from "./annotator/AreaList";
import { BackgroundImagePanel } from "./annotator/BackgroundImagePanel";
import { SitePlanTools } from "./annotator/SitePlanTools";
import { SiteElementsList } from "./annotator/SiteElementsList";
import { useFloorplanStore } from "./state/floorplanStore";
import {
  connectWorkspaceApi,
  getCurrentProject,
  registerMainMenu,
  requestAccessTokenPermission,
} from "./trimble/workspaceClient";
import {
  extractAccessTokenFromPayload,
  getCachedAccessToken,
  setCachedAccessToken,
  updateAccessTokenCacheFromEvent,
} from "./trimble/accessToken";
import {
  detectLocale,
  LocaleProvider,
  useSetLocale,
  useTranslations,
  type Locale,
  type LocaleProbeApi,
} from "./i18n";

const TOKEN_WAIT_TIMEOUT_MS = 15_000;
const TOKEN_POLL_INTERVAL_MS = 100;

/**
 * Top-level component. Owns the boot-time handshake with Trimble Connect:
 * connect to the Workspace API, detect the user's locale, fetch the active
 * project context, request the access token, and surface any boot error
 * down to the status bar.
 *
 * All copy that reaches the DOM is read from the i18n provider — the App
 * itself is locale-agnostic.
 */
export function App(): JSX.Element {
  const [initialLocale, setInitialLocale] = useState<Locale>("en");
  const [localeReady, setLocaleReady] = useState(false);

  // We detect the locale once, eagerly, so the very first render already uses
  // the right language. If detection fails, we fall back to English.
  const detectionStartedRef = useRef(false);
  useEffect(() => {
    if (detectionStartedRef.current) return;
    detectionStartedRef.current = true;
    void detectLocale(null).then((detected) => {
      setInitialLocale(detected.locale);
      setLocaleReady(true);
    });
  }, []);

  if (!localeReady) return <BootSplash />;

  return (
    <LocaleProvider initialLocale={initialLocale}>
      <AppShell />
    </LocaleProvider>
  );
}

function BootSplash(): JSX.Element {
  // Minimal splash while we resolve the locale. Intentionally non-localised —
  // it shows for a single tick before the LocaleProvider mounts.
  return (
    <div className="empty-state">
      <div className="empty-state__title">sitePlan2D</div>
    </div>
  );
}

/**
 * Inner shell that runs with the LocaleProvider installed. Splitting the
 * provider out from the bootstrapper keeps the locale detection effect
 * single-shot, while every consumer of `useTranslations` can mount safely.
 */
function AppShell(): JSX.Element {
  const t = useTranslations();
  const setLocale = useSetLocale();
  const setProject = useFloorplanStore((s) => s.setProject);
  const setAccessToken = useFloorplanStore((s) => s.setAccessToken);
  const setStatus = useFloorplanStore((s) => s.setStatus);
  const status = useFloorplanStore((s) => s.status);
  const selectedStoreyExpressId = useFloorplanStore((s) => s.selectedStoreyExpressId);
  const selectedStoreyDoc = useFloorplanStore((s) =>
    selectedStoreyExpressId != null ? s.storeyDocuments[selectedStoreyExpressId] : undefined,
  );

  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      try {
        setStatus(t.status.connecting);
        const workspaceApi = await connectWorkspaceApi((eventName, eventArgs) => {
          if (eventName === "extension.accessToken") {
            const token = updateAccessTokenCacheFromEvent(eventArgs);
            if (token) setAccessToken(token);
          }
        });
        if (cancelled) return;
        // Register the extension's main-menu entry. Without this call the
        // extension never appears in Trimble Connect's right-side navigation
        // — the iframe loads but the user has no way to reach it.
        // Registered as early as possible so the menu icon shows up
        // regardless of whether subsequent boot steps are still in flight.
        // Failures are non-fatal but logged so an operator can diagnose
        // Workspace API mismatches.
        try {
          await registerMainMenu(workspaceApi);
        } catch (menuRegistrationError) {
          console.warn("[sitePlan2D] menu registration failed", menuRegistrationError);
        }
        // Refine the language detection now that the Workspace API is live.
        // The boot splash used a navigator-only detection because the API
        // wasn't reachable yet.
        const refinedLocale = await detectLocale(workspaceApi as unknown as LocaleProbeApi);
        if (!cancelled) setLocale(refinedLocale.locale);
        setStatus(t.status.fetchingProject);
        const project = await getCurrentProject(workspaceApi);
        if (cancelled) return;
        setProject(project);
        setStatus(t.status.requestingPermission);
        const permissionResponse = await requestAccessTokenPermission(workspaceApi);
        if (cancelled) return;
        const tokenFromPermission = extractAccessTokenFromPayload(permissionResponse);
        if (tokenFromPermission) {
          setCachedAccessToken(tokenFromPermission);
          setAccessToken(tokenFromPermission);
        } else {
          const tokenFromEvent = await waitForCachedAccessToken(TOKEN_WAIT_TIMEOUT_MS);
          if (tokenFromEvent) setAccessToken(tokenFromEvent);
        }
        setStatus(t.status.ready);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setBootError(message);
          setStatus(t.status.error);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [setAccessToken, setLocale, setProject, setStatus, t.status]);

  return (
    <Layout
      header={<span className="app-header__title">{t.appTitle}</span>}
      sidebar={
        <>
          <FileBrowser />
          <SavedFloorplans />
          <StoreyList />
          <EntityTypePicker />
          <RenderOptionsPanel />
          {selectedStoreyDoc ? <BackgroundImagePanel document={selectedStoreyDoc} /> : null}
          {selectedStoreyDoc ? <SitePlanTools /> : null}
          <Toolbar />
          <PdfExportPanel />
          {selectedStoreyDoc ? <AreaList document={selectedStoreyDoc} /> : null}
          {selectedStoreyDoc ? <SiteElementsList document={selectedStoreyDoc} /> : null}
        </>
      }
      main={<ViewerPane />}
      footer={<StatusBar status={status} error={bootError} />}
    />
  );
}

async function waitForCachedAccessToken(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cached = getCachedAccessToken();
    if (cached) return cached;
    await delay(TOKEN_POLL_INTERVAL_MS);
  }
  return getCachedAccessToken();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
