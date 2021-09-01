export default function () {
  return function ({ addUtilities, variants }) {
    addUtilities(
      {
        '.appearance-none': {
          '-webkit-appearance': 'none',
          appearance: 'none',
        },
      },
      variants('appearance')
    )
  }
}
