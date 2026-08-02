import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pinned, not inferred. Next locates the workspace root by searching upward for a
    // lockfile, and there is a stray `package-lock.json` in the home directory — so it
    // selected `/Users/utkarshgarg` and began resolving and watching everything above
    // this project, including `~/Desktop`. That is what made `next dev` fail outright
    // with `reading dir "/Users/utkarshgarg/Desktop": Operation not permitted`.
    //
    // Setting it here fixes the cause rather than the symptom: module resolution stays
    // inside the project, filesystem watching shrinks to the files that matter, and the
    // build stops depending on what happens to sit in the user's home directory.
    root: import.meta.dirname,
  },
};

export default nextConfig;
