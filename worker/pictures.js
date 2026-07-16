const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 18 * 1024 * 1024;
const MAX_IMAGE_EDGE = 12000;
const MAX_IMAGE_PIXELS = 60_000_000;
const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  } });
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function signatureMatches(bytes, type) {
  if (type === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}

function dimensions(bytes, type) {
  if (type === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: (bytes[offset + 7] << 8) + bytes[offset + 8], height: (bytes[offset + 5] << 8) + bytes[offset + 6] };
      }
      if (!length) break;
      offset += length + 2;
    }
  }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)
      };
    }
    if (chunk === 'VP8 ') {
      for (let index = 20; index + 6 < bytes.length; index += 1) {
        if (bytes[index] === 0x9d && bytes[index + 1] === 0x01 && bytes[index + 2] === 0x2a) {
          return {
            width: (bytes[index + 3] + (bytes[index + 4] << 8)) & 0x3fff,
            height: (bytes[index + 5] + (bytes[index + 6] << 8)) & 0x3fff
          };
        }
      }
    }
  }
  return { width: null, height: null };
}

function validRequestId(value) {
  const requestId = cleanText(value, 80).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{7,79}$/.test(requestId) ? requestId : '';
}

function pictureUrl(row) {
  if (!row.object_key) return row.path;
  const version = encodeURIComponent(row.updated_at || row.created_at || row.id);
  return `/product-images/${row.id}?v=${version}`;
}

function mapPicture(row) {
  return {
    id: row.id,
    productId: row.product_id,
    url: pictureUrl(row),
    thumbnailUrl: row.thumbnail_object_key
      ? `/product-images/${row.id}/thumbnail?v=${encodeURIComponent(row.updated_at || row.created_at || row.id)}`
      : pictureUrl(row),
    altText: row.alt_text || '',
    sortOrder: Number(row.sort_order || 0),
    isPrimary: Boolean(row.is_primary),
    active: Boolean(row.active),
    variantStyle: row.variant_style || '',
    mimeType: row.mime_type || '',
    fileSize: Number(row.file_size || 0),
    width: row.width || null,
    height: row.height || null,
    storage: row.object_key ? 'R2' : 'Static',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function audit(db, identity, action, entityId, summary) {
  await db.prepare(`INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
    VALUES (?, ?, 'product_image', ?, ?)`)
    .bind(identity.email, action, String(entityId), cleanText(summary, 500)).run();
}

async function productExists(db, productId) {
  return db.prepare('SELECT id, name FROM products WHERE id = ?').bind(productId).first();
}

async function listProductPictures(db, productId) {
  const result = await db.prepare(`SELECT * FROM product_images WHERE product_id = ? AND active = 1
    ORDER BY is_primary DESC, sort_order, id`).bind(productId).all();
  return (result.results || []).map(mapPicture);
}

async function listAll(db, env) {
  const [productsResult, picturesResult] = await Promise.all([
    db.prepare('SELECT id, name FROM products ORDER BY name').all(),
    db.prepare('SELECT * FROM product_images WHERE active = 1 ORDER BY product_id, is_primary DESC, sort_order, id').all()
  ]);
  const pictures = picturesResult.results || [];
  return {
    storageReady: Boolean(env.PRODUCT_IMAGES),
    products: (productsResult.results || []).map(product => ({
      id: product.id,
      name: product.name,
      pictures: pictures.filter(row => row.product_id === product.id).map(mapPicture)
    }))
  };
}

async function parseUpload(request) {
  if (!String(request.headers.get('content-type') || '').toLowerCase().startsWith('multipart/form-data')) {
    return { error: 'A multipart image upload is required.', code: 'INVALID_MULTIPART' };
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_MULTIPART_BYTES) return { error: 'The upload request is too large.', code: 'REQUEST_TOO_LARGE' };
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Choose an image to upload.', code: 'FILE_REQUIRED' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'The image is larger than 8 MB.', code: 'FILE_TOO_LARGE' };
  const type = String(file.type || '').toLowerCase();
  const extension = ALLOWED_TYPES.get(type);
  if (!extension) return { error: 'Only JPEG, PNG, and WebP images are accepted.', code: 'UNSUPPORTED_FILE_TYPE' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!signatureMatches(bytes, type)) return { error: 'The file contents do not match the selected image type.', code: 'INVALID_FILE_SIGNATURE' };
  const imageDimensions = dimensions(bytes, type);
  if (!imageDimensions.width || !imageDimensions.height) return { error: 'The image dimensions could not be verified.', code: 'INVALID_IMAGE_DIMENSIONS' };
  if (imageDimensions.width > MAX_IMAGE_EDGE || imageDimensions.height > MAX_IMAGE_EDGE || imageDimensions.width * imageDimensions.height > MAX_IMAGE_PIXELS) {
    return { error: `Image dimensions are too large. Use no more than ${MAX_IMAGE_EDGE}px per edge and 60 megapixels.`, code: 'IMAGE_DIMENSIONS_TOO_LARGE' };
  }
  const thumbnail = form.get('thumbnail');
  let thumbnailUpload = null;
  if (thumbnail instanceof File && thumbnail.size) {
    const thumbnailType = String(thumbnail.type || '').toLowerCase();
    if (thumbnail.size > 1024 * 1024 || !ALLOWED_TYPES.has(thumbnailType)) return { error: 'The generated thumbnail is invalid.', code: 'INVALID_THUMBNAIL' };
    const thumbnailBytes = new Uint8Array(await thumbnail.arrayBuffer());
    if (!signatureMatches(thumbnailBytes, thumbnailType)) return { error: 'The thumbnail contents are invalid.', code: 'INVALID_THUMBNAIL' };
    thumbnailUpload = { file: thumbnail, bytes: thumbnailBytes, type: thumbnailType, extension: ALLOWED_TYPES.get(thumbnailType) };
  }
  return {
    form, file, bytes, type, extension, thumbnail: thumbnailUpload,
    requestId: validRequestId(form.get('requestId')),
    altText: cleanText(form.get('altText'), 200),
    variantStyle: cleanText(form.get('variantStyle'), 80),
    replacePictureId: validId(form.get('replacePictureId')),
    ...imageDimensions
  };
}

async function uploadPicture(request, env, identity, productId) {
  const startedAt = Date.now();
  let requestId = validRequestId(request.headers.get('X-Upload-Request-ID')) || crypto.randomUUID();
  const context = { requestId, admin: identity.email, productId, action: 'upload' };
  if (!env.PRODUCT_IMAGES) return failure('R2_NOT_CONFIGURED', 'R2 image storage is not enabled for this Worker yet.', 503, requestId);
  const product = await productExists(env.DB, productId);
  if (!product) return failure('PRODUCT_NOT_FOUND', 'Product not found.', 404, requestId);
  let upload;
  try { upload = await parseUpload(request); }
  catch (error) {
    logUpload({ ...context, status: 'rejected', errorCode: 'INVALID_UPLOAD_BODY', durationMs: Date.now() - startedAt });
    return failure('INVALID_UPLOAD_BODY', 'The upload could not be read.', 400, requestId);
  }
  requestId = upload.requestId || requestId;
  context.requestId = requestId;
  Object.assign(context, { mimeType: upload.type, fileSize: upload.file?.size || 0, width: upload.width || null, height: upload.height || null });
  if (upload.error) {
    logUpload({ ...context, status: 'rejected', errorCode: upload.code, durationMs: Date.now() - startedAt });
    return failure(upload.code, upload.error, 400, requestId);
  }

  const completed = await env.DB.prepare('SELECT id, product_id, active FROM product_images WHERE upload_request_id = ?').bind(requestId).first();
  if (completed) {
    if (completed.product_id !== productId || !completed.active) return failure('REQUEST_ID_CONFLICT', 'This upload request identifier cannot be reused.', 409, requestId);
    logUpload({ ...context, status: 'idempotent_success', pictureId: completed.id, durationMs: Date.now() - startedAt });
    return json({ ok: true, requestId, idempotent: true, pictures: await listProductPictures(env.DB, productId) });
  }

  let replaced = null;
  if (upload.replacePictureId) {
    replaced = await env.DB.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ? AND active = 1').bind(upload.replacePictureId, productId).first();
    if (!replaced) return failure('REPLACE_TARGET_NOT_FOUND', 'The picture to replace was not found.', 404, requestId);
    context.action = 'replace';
  }

  const key = `products/${productId}/${requestId}.${upload.extension}`;
  const thumbnailKey = upload.thumbnail ? `products/${productId}/thumbnails/${requestId}.${upload.thumbnail.extension}` : '';
  let d1Committed = false;
  try {
    await env.PRODUCT_IMAGES.put(key, upload.bytes, {
      httpMetadata: { contentType: upload.type, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { productId, uploadedBy: identity.email, requestId, width: String(upload.width), height: String(upload.height) }
    });
    if (upload.thumbnail) {
      await env.PRODUCT_IMAGES.put(thumbnailKey, upload.thumbnail.bytes, {
        httpMetadata: { contentType: upload.thumbnail.type, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { productId, uploadedBy: identity.email, requestId, purpose: 'thumbnail' }
      });
    }
    if (replaced) {
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE product_images SET object_key = ?, delivery_url = ?, thumbnail_object_key = ?, thumbnail_delivery_url = ?, mime_type = ?, file_size = ?,
        width = ?, height = ?, alt_text = ?, variant_style = ?, uploaded_by = ?, updated_at = CURRENT_TIMESTAMP
        , upload_request_id = ? WHERE id = ? AND product_id = ? AND active = 1`)
        .bind(key, `/product-images/${replaced.id}`, thumbnailKey, thumbnailKey ? `/product-images/${replaced.id}/thumbnail` : '', upload.type, upload.file.size, upload.width, upload.height,
          upload.altText || replaced.alt_text || product.name, upload.variantStyle, identity.email, requestId, replaced.id, productId),
        env.DB.prepare(`INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
          VALUES (?, 'replace', 'product_image', ?, ?)`).bind(identity.email, String(replaced.id), `Replaced picture for ${product.name}; request ${requestId}`)
      ]);
      if (!results[0]?.meta?.changes) throw new Error('D1_REPLACE_NOT_COMMITTED');
      d1Committed = true;
      for (const oldKey of [replaced.object_key, replaced.thumbnail_object_key]) {
        if (oldKey && oldKey !== key && oldKey !== thumbnailKey) {
          try { await env.PRODUCT_IMAGES.delete(oldKey); }
          catch (error) { logUpload({ ...context, status: 'cleanup_warning', errorCode: 'OLD_OBJECT_CLEANUP_FAILED' }); }
        }
      }
    } else {
      const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value, COUNT(*) AS count FROM product_images WHERE product_id = ? AND active = 1').bind(productId).first();
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO product_images
          (product_id, path, object_key, delivery_url, thumbnail_object_key, thumbnail_delivery_url, mime_type, file_size, width, height, alt_text, sort_order, is_primary, active, uploaded_by, variant_style, upload_request_id)
          SELECT ?, '', ?, '', ?, '', ?, ?, ?, ?, ?, ?,
            CASE WHEN EXISTS (SELECT 1 FROM product_images WHERE product_id = ? AND active = 1) THEN 0 ELSE 1 END,
            1, ?, ?, ?`)
          .bind(productId, key, thumbnailKey, upload.type, upload.file.size, upload.width, upload.height,
            upload.altText || product.name, Number(max?.value || 0) + 1, productId, identity.email, upload.variantStyle, requestId),
        env.DB.prepare(`INSERT INTO admin_audit_log (admin_email, action, entity_type, entity_id, summary)
          VALUES (?, 'upload', 'product_image', ?, ?)`).bind(identity.email, requestId, `Uploaded picture for ${product.name}; request ${requestId}`)
      ]);
      if (!results[0]?.meta?.changes) throw new Error('D1_INSERT_NOT_COMMITTED');
      d1Committed = true;
    }
  } catch (error) {
    if (!d1Committed) {
      try { await env.PRODUCT_IMAGES.delete(key); } catch {}
      if (thumbnailKey) { try { await env.PRODUCT_IMAGES.delete(thumbnailKey); } catch {} }
    }
    const errorCode = String(error.message || '').startsWith('D1_') ? 'DATABASE_COMMIT_FAILED' : 'R2_UPLOAD_FAILED';
    logUpload({ ...context, status: 'failed', r2Stored: false, d1Committed, errorCode, durationMs: Date.now() - startedAt });
    return failure(errorCode, errorCode === 'DATABASE_COMMIT_FAILED' ? 'The image was uploaded but its database record could not be saved. Nothing was changed; please retry.' : 'R2 could not store the image. Please retry.', 502, requestId);
  }
  const pictures = await listProductPictures(env.DB, productId);
  const picture = pictures.find(item => item.id === replaced?.id) || pictures[pictures.length - 1];
  logUpload({ ...context, status: 'succeeded', pictureId: picture?.id || null, r2Stored: true, d1Committed: true, durationMs: Date.now() - startedAt });
  return json({ ok: true, requestId, pictures }, replaced ? 200 : 201);
}

async function updatePicture(request, env, identity, pictureId) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'A JSON object is required.' }, 400);
  const unknown = Object.keys(body).find(key => !['altText', 'variantStyle'].includes(key));
  if (unknown) return json({ ok: false, error: `Unknown field: ${unknown}.` }, 400);
  const picture = await env.DB.prepare('SELECT * FROM product_images WHERE id = ? AND active = 1').bind(pictureId).first();
  if (!picture) return json({ ok: false, error: 'Picture not found.' }, 404);
  const altText = cleanText(body.altText, 200);
  if (!altText) return json({ ok: false, error: 'Alt text is required.' }, 400);
  await env.DB.prepare('UPDATE product_images SET alt_text = ?, variant_style = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(altText, cleanText(body.variantStyle, 80), pictureId).run();
  await audit(env.DB, identity, 'update', pictureId, 'Updated picture metadata');
  return json({ ok: true, pictures: await listProductPictures(env.DB, picture.product_id) });
}

async function setPrimary(env, identity, pictureId) {
  const picture = await env.DB.prepare('SELECT * FROM product_images WHERE id = ? AND active = 1').bind(pictureId).first();
  if (!picture) return json({ ok: false, error: 'Picture not found.' }, 404);
  await env.DB.batch([
    env.DB.prepare('UPDATE product_images SET is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').bind(picture.product_id),
    env.DB.prepare('UPDATE product_images SET is_primary = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(pictureId)
  ]);
  await audit(env.DB, identity, 'set_primary', pictureId, 'Changed the main product picture');
  return json({ ok: true, pictures: await listProductPictures(env.DB, picture.product_id) });
}

async function reorder(request, env, identity, productId) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.pictureIds) ? body.pictureIds.map(validId) : [];
  if (!ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) return json({ ok: false, error: 'A unique ordered picture list is required.' }, 400);
  const current = await listProductPictures(env.DB, productId);
  if (ids.length !== current.length || ids.some(id => !current.find(picture => picture.id === id))) return json({ ok: false, error: 'The picture list changed. Refresh and try again.' }, 409);
  await env.DB.batch(ids.map((id, index) => env.DB.prepare('UPDATE product_images SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND product_id = ?').bind(index + 1, id, productId)));
  await audit(env.DB, identity, 'reorder', productId, 'Reordered product pictures');
  return json({ ok: true, pictures: await listProductPictures(env.DB, productId) });
}

async function removePicture(env, identity, pictureId) {
  const picture = await env.DB.prepare('SELECT * FROM product_images WHERE id = ? AND active = 1').bind(pictureId).first();
  if (!picture) return json({ ok: false, error: 'Picture not found.' }, 404);
  const count = await env.DB.prepare('SELECT COUNT(*) AS value FROM product_images WHERE product_id = ? AND active = 1').bind(picture.product_id).first();
  if (Number(count?.value || 0) <= 1) return json({ ok: false, error: 'A product must keep at least one usable picture.' }, 409);
  await env.DB.prepare('UPDATE product_images SET active = 0, is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(pictureId).run();
  if (picture.is_primary) {
    const next = await env.DB.prepare('SELECT id FROM product_images WHERE product_id = ? AND active = 1 ORDER BY sort_order, id LIMIT 1').bind(picture.product_id).first();
    if (next) await env.DB.prepare('UPDATE product_images SET is_primary = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next.id).run();
  }
  await audit(env.DB, identity, 'remove', pictureId, 'Removed product picture');
  if (picture.object_key && env.PRODUCT_IMAGES) await env.PRODUCT_IMAGES.delete(picture.object_key);
  if (picture.thumbnail_object_key && env.PRODUCT_IMAGES) await env.PRODUCT_IMAGES.delete(picture.thumbnail_object_key);
  return json({ ok: true, pictures: await listProductPictures(env.DB, picture.product_id) });
}

export async function serveProductPicture(request, env, pictureId, thumbnail = false) {
  if (!env.DB || !env.PRODUCT_IMAGES) return new Response('Not found', { status: 404 });
  const picture = await env.DB.prepare('SELECT object_key, thumbnail_object_key, mime_type FROM product_images WHERE id = ? AND active = 1 AND object_key != ?').bind(pictureId, '').first();
  if (!picture) return new Response('Not found', { status: 404 });
  const objectKey = thumbnail && picture.thumbnail_object_key ? picture.thumbnail_object_key : picture.object_key;
  const object = await env.PRODUCT_IMAGES.get(objectKey);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', picture.mime_type || headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
  headers.set('Cross-Origin-Resource-Policy', 'same-site');
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

function failure(code, error, status, requestId = '') {
  return json({ ok: false, code, error, requestId }, status);
}

function logUpload(event) {
  console.log(JSON.stringify({ scope: 'admin_picture', ...event }));
}

export async function handlePicturesApi(request, env, identity) {
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured.' }, 503);
  const path = new URL(request.url).pathname.replace(/^\/api\/admin\/?/, '');
  const segments = path.split('/').filter(Boolean);
  const method = request.method.toUpperCase();
  try {
    if (method === 'GET' && segments[0] === 'pictures' && segments.length === 1) return json({ ok: true, ...(await listAll(env.DB, env)) });
    if (segments[0] === 'products' && segments[2] === 'pictures' && segments.length === 3) {
      const productId = cleanText(decodeURIComponent(segments[1]), 120);
      if (method === 'GET') {
        const product = await productExists(env.DB, productId);
        return product ? json({ ok: true, product, storageReady: Boolean(env.PRODUCT_IMAGES), pictures: await listProductPictures(env.DB, productId) }) : json({ ok: false, error: 'Product not found.' }, 404);
      }
      if (method === 'POST') return uploadPicture(request, env, identity, productId);
    }
    if (method === 'POST' && segments[0] === 'products' && segments[2] === 'pictures' && segments[3] === 'reorder' && segments.length === 4) {
      return reorder(request, env, identity, cleanText(decodeURIComponent(segments[1]), 120));
    }
    const pictureId = validId(segments[1]);
    if (segments[0] === 'pictures' && pictureId) {
      if (method === 'PUT' && segments.length === 2) return updatePicture(request, env, identity, pictureId);
      if (method === 'POST' && segments[2] === 'set-primary' && segments.length === 3) return setPrimary(env, identity, pictureId);
      if (method === 'DELETE' && segments.length === 2) return removePicture(env, identity, pictureId);
    }
    return json({ ok: false, error: 'Pictures endpoint not found.' }, 404);
  } catch (error) {
    console.error('Pictures API request failed', { method, path, message: error.message });
    return json({ ok: false, error: 'The picture request could not be completed.' }, 500);
  }
}
