import transformThemeValue from './transformThemeValue'
import isPlainObject from './isPlainObject'

export default function createUtilityPlugin(
  themeKey,
  utilityVariations = [[themeKey, [themeKey]]],
  pluginOptions = {}
) {
  let transformValue = transformThemeValue(themeKey)
  return function ({ matchUtilities, theme }) {
    for (let utilityVariation of utilityVariations) {
      let group = Array.isArray(utilityVariation[0]) ? utilityVariation : [utilityVariation]
      let groupOptions = group.find((arrOrObj) => isPlainObject(arrOrObj))
      let { filterDefault = false, ...options } = { ...pluginOptions, ...groupOptions }

      matchUtilities(
        group
          .filter((arrOrObj) => Array.isArray(arrOrObj))
          .reduce((obj, [classPrefix, properties]) => {
            return Object.assign(obj, {
              [classPrefix]: (value) => {
                return properties.reduce((obj, name) => {
                  if (Array.isArray(name)) {
                    return Object.assign(obj, { [name[0]]: name[1] })
                  }
                  return Object.assign(obj, { [name]: transformValue(value) })
                }, {})
              },
            })
          }, {}),
        {
          ...options,
          values: filterDefault
            ? Object.fromEntries(
                Object.entries(theme(themeKey) ?? {}).filter(([modifier]) => modifier !== 'DEFAULT')
              )
            : theme(themeKey),
        }
      )
    }
  }
}
