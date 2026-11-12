// Files embedded in the executable with `import path from "…" with { type: "file" }`: Bun gives
// their path, to read at run time.
declare module "*.br" { const path: string; export default path; }
declare module "*.exe" { const path: string; export default path; }
declare module "*.pul" { const path: string; export default path; }
declare module "*.szs" { const path: string; export default path; }
declare module "*.xml" { const path: string; export default path; }
declare module "*.txt" { const path: string; export default path; }
declare module "*.md" { const path: string; export default path; }
declare module "*.png" { const path: string; export default path; }
declare module "*.ico" { const path: string; export default path; }
declare module "*.html" { const path: string; export default path; }
declare module "*.css" { const path: string; export default path; }
declare module "*.woff2" { const path: string; export default path; }
declare module "*/LICENSE" { const path: string; export default path; }
