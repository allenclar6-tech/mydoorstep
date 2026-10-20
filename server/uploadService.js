import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const allowedTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['application/pdf', '.pdf'],
])
const maxBytes = 5 * 1024 * 1024
const privateRoot = path.resolve(process.env.PRIVATE_UPLOAD_DIR || './private-uploads')

export async function storePrivateDocument({ buffer, mimeType, originalName, keyPrefix = 'private/' }) {
  const extension = allowedTypes.get(mimeType)
  if (!extension) throw uploadError('UNSUPPORTED_DOCUMENT_TYPE', 'Only PDF, JPEG, and PNG documents are accepted.', 400)
  if (!buffer?.length || buffer.length > maxBytes) throw uploadError('DOCUMENT_TOO_LARGE', 'Documents must be between 1 byte and 5 MB.', 400)
  if (mimeType.startsWith('image/') && !hasImageSignature(buffer, mimeType)) throw uploadError('INVALID_IMAGE_SIGNATURE', 'The uploaded image could not be verified.', 400)
  if (mimeType === 'application/pdf' && !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw uploadError('INVALID_PDF_SIGNATURE', 'The uploaded PDF could not be verified.', 400)

  const safeName = `${Date.now()}-${randomBytes(10).toString('hex')}${extension}`
  const normalizedPrefix = keyPrefix.endsWith('/') ? keyPrefix : `${keyPrefix}/`
  if (!normalizedPrefix.startsWith('private/')) throw uploadError('INVALID_STORAGE_PREFIX', 'Private storage prefixes are required.', 400)
  const relativeKey = `${normalizedPrefix}${safeName}`
  const absolutePath = path.join(privateRoot, relativeKey.slice('private/'.length))
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, buffer, { flag: 'wx', mode: 0o600 })
  return { storageKey: relativeKey, checksum: createHash('sha256').update(buffer).digest('hex'), originalName: path.basename(originalName || safeName), mimeType, size: buffer.length }
}

export async function readPrivateDocument(storageKey) {
  if (typeof storageKey !== 'string' || !storageKey.startsWith('private/')) throw uploadError('INVALID_STORAGE_KEY', 'A private storage key is required.', 400)

  const relativePath = storageKey.slice('private/'.length)
  const absolutePath = path.resolve(privateRoot, relativePath)
  if (!absolutePath.startsWith(`${privateRoot}${path.sep}`)) throw uploadError('INVALID_STORAGE_KEY', 'The storage key is invalid.', 400)

  const extension = path.extname(absolutePath)
  const mimeType = [...allowedTypes.entries()].find(([, allowedExtension]) => allowedExtension === extension)?.[0]
  if (!mimeType) throw uploadError('UNSUPPORTED_DOCUMENT_TYPE', 'The stored document type is unsupported.', 400)

  try {
    return { buffer: await readFile(absolutePath), mimeType }
  } catch (error) {
    if (error?.code === 'ENOENT') throw uploadError('PRIVATE_DOCUMENT_NOT_FOUND', 'The requested document was not found.', 404)
    throw error
  }
}

function hasImageSignature(buffer, mimeType) {
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
}

export function uploadError(code, message, status) { return Object.assign(new Error(message), { code, status }) }

export async function removePrivateDocument(storageKey) {
  if (typeof storageKey !== 'string' || !storageKey.startsWith('private/')) throw uploadError('INVALID_STORAGE_KEY', 'Invalid storage key.', 400)
  const target = path.resolve(privateRoot, storageKey.slice('private/'.length))
  if (!target.startsWith(`${privateRoot}${path.sep}`)) throw uploadError('INVALID_STORAGE_KEY', 'Invalid storage key.', 400)
  try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

/**
 * True only for a file this user uploaded: exactly `private/users/<userId>/<name>.<ext>` with no further
 * path segments. A prefix check alone would accept `private/users/<me>/../<someone-else>/…`, which the
 * reader would then resolve to another person's file.
 */
export function isOwnPrivateKey(userId, storageKey) {
  if (typeof storageKey !== 'string' || typeof userId !== 'string' || !userId) return false
  const prefix = `private/users/${userId}/`
  return storageKey.startsWith(prefix) && /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|pdf)$/.test(storageKey.slice(prefix.length))
}
