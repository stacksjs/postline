/**
 * Hand the page the same counting and image rules the server uses, so the
 * composer and the server's checks cannot disagree.
 */
import { countText } from '../../../app/Support/Social/count-text'
import { mediaObjections } from '../../../app/Support/Social/media-rules'

declare global {
  interface Window {
    postlineCountText?: typeof countText
    /** Which of the chosen networks will not take an image, and why. */
    postlineMediaObjections?: typeof mediaObjections
  }
}

window.postlineCountText = countText
window.postlineMediaObjections = mediaObjections
