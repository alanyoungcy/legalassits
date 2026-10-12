/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: [
    "@docx-editor.dev/react",
    "@docx-editor.dev/core",
    "@docx-editor.dev/i18n",
    "@docx-editor.dev/fonts",
  ],
};

module.exports = nextConfig;
