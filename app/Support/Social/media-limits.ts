const MB = 1024 * 1024

export const POST_IMAGE_FORMATS: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const MAX_POST_IMAGES = 4
export const MAX_IMAGE_BYTES = 10 * MB
export const MAX_VIDEO_BYTES = MAX_POST_IMAGES * MAX_IMAGE_BYTES
