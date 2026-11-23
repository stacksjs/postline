/**
 * Hand the page the same counting the server uses, so the composer's counter
 * and the server's limit check cannot disagree.
 */
import { countText } from '../../../app/Support/Social/count-text'

declare global {
  interface Window {
    postlineCountText?: typeof countText
  }
}

window.postlineCountText = countText
