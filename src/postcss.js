/**
 * Try to load the user's local version of PostCSS first
 * If we can't find it we'll use our bundled version instead.
 *
 * This ensures things like `npx tailwindcss init` work
 * regardless of NPM/Yarn version, peer dependencies, etc…
 *
 * @returns {import('postcss')}
 */
function loadPostCss() {
  try {
    return require('postcss')
  } catch (err) {
    return require('../peers/index.js').postcss
  }
}

module.exports = loadPostCss()
