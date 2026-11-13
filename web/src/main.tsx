import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

// Without this an error while drawing leaves an empty, black window with no reason given.
class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error("The editor stopped working:", error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-sm">
        <p className="m-0 font-semibold">The editor stopped working</p>
        <pre className="max-h-64 max-w-[800px] overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 font-mono text-[11px]">{error.stack || error.message || String(error)}</pre>
        <button type="button" className="rounded border px-3 py-1.5 hover:bg-accent" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(<RootErrorBoundary><App /></RootErrorBoundary>);
