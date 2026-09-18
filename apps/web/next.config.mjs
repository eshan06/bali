/** @type {import('next').NextConfig} */
const nextConfig = {
  // @bali/shared ships as TypeScript/ESM; let Next transpile it in-app rather
  // than requiring a prebuilt dist.
  transpilePackages: ['@bali/shared'],
  // The monorepo root lints everything with `eslint .`, so skip Next's own
  // lint-during-build (which would need eslint-config-next we don't install).
  eslint: { ignoreDuringBuilds: true },
  // @bali/shared uses NodeNext `.js` import specifiers that actually resolve to
  // `.ts` sources; webpack doesn't do that mapping on its own, so teach it.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;
