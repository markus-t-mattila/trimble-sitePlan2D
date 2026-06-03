import type { ReactNode } from "react";

interface LayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  footer: ReactNode;
}

/**
 * Top-level grid frame. Header on top, sidebar on the left, main viewport on
 * the right, status footer at the bottom. The grid template lives in the
 * stylesheet so this component is free of layout literals.
 */
export function Layout({ header, sidebar, main, footer }: LayoutProps): JSX.Element {
  return (
    <div className="app-layout">
      <header className="app-header">{header}</header>
      <aside className="app-sidebar">{sidebar}</aside>
      <section className="app-main">{main}</section>
      <footer className="app-footer">{footer}</footer>
    </div>
  );
}
