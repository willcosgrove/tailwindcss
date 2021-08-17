import postcss from 'postcss'
import nesting from './plugin'

module.exports = postcss.plugin('tailwindcss/nesting', nesting)
