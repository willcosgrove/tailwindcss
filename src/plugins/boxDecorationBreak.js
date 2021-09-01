export default function () {
  return function ({ addUtilities, variants }) {
    addUtilities(
      {
        '.decoration-slice': {
          '-webkit-box-decoration-break': 'slice',
          'box-decoration-break': 'slice',
        },
        '.decoration-clone': {
          '-webkit-box-decoration-break': 'clone',
          'box-decoration-break': 'clone',
        },
      },
      variants('boxDecorationBreak')
    )
  }
}
