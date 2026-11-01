// Every WebView has its own document and viewport. A shared server stays alive until its last
// native window closes, so closing Home never cuts disk access off from another track editor.
export class EditorWindows {
  private children = new Set<Promise<number>>();
  private idle: (() => void)[] = [];
  constructor(private command: string[] | null = null) {}
  get count() { return this.children.size; }

  open(url: string, onExit?: () => void) {
    if (!this.command) return { url };
    const child = Bun.spawn([...this.command, "--window-url", url], {
      stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true,
    });
    const exited = child.exited;
    this.children.add(exited);
    void exited.finally(() => {
      this.children.delete(exited);
      onExit?.();
      if (!this.count) this.idle.splice(0).forEach((done) => done());
    });
    return { native: true };
  }

  whenIdle() {
    return this.count ? new Promise<void>((done) => this.idle.push(done)) : Promise.resolve();
  }
}
