export const INSPECT_ICON_BODY = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r=".5" fill="currentColor"></circle><path d="M5 12a7 7 0 1 0 14 0a7 7 0 1 0-14 0m7-9v2m-9 7h2m7 7v2m7-9h2"></path></g>'

export const INSPECT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="height: 1.2em; width: 1.2em; opacity: 0.5;">${INSPECT_ICON_BODY}</svg>`

const dataUri = (color: 'black' | 'white'): string => `data:image/svg+xml,${encodeURIComponent(INSPECT_ICON_SVG.replaceAll('currentColor', color))}`

export const INSPECT_ICON = {
  light: dataUri('black'),
  dark: dataUri('white'),
} as const
