import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import { SvgCanvas } from "./SvgCanvas";

/**
 * Main viewer surface. Decides whether to render an empty state (no storey
 * picked or no documents generated yet) or the SVG canvas for the active
 * storey.
 */
export function ViewerPane(): JSX.Element {
  const t = useTranslations();
  const selectedStoreyExpressId = useFloorplanStore((state) => state.selectedStoreyExpressId);
  const document = useFloorplanStore((state) =>
    selectedStoreyExpressId != null ? state.storeyDocuments[selectedStoreyExpressId] : undefined,
  );
  if (!document) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">{t.appTitle}</div>
        <p className="empty-state__hint">{t.viewer.emptyState}</p>
      </div>
    );
  }
  return <SvgCanvas document={document} />;
}
