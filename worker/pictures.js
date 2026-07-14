const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
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
  return { width: null, height: null };
}

function pictureUrl(row) {
  return row.delivery_url || row.path;
}

function mapPicture(row) {
  return {
    id: row.id,
    productId: row.product_id,
    url: pictureUrl(row),
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
    return { error: 'A multipart image upload is required.' };
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_UPLOAD_BYTES + 1024 * 1024) return { error: 'The image is larger than 8 MB.' };
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Choose an image to upload.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'The image is larger than 8 MB.' };
  const type = String(file.type || '').toLowerCase();
  const extension = ALLOWED_TYPES.get(type);
  if (!extension) return { error: 'Only JPEG, PNG, and WebP images are accepted.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!signatureMatches(bytes, type)) return { error: 'The file contents do not match the selected image type.' };
  return {
    form, file, bytes, type, extension,
    altText: cleanText(form.get('altText'), 200),
    variantStyle: cleanText(form.get('variantStyle'), 80),
    replacePictureId: validId(form.get('replacePictureId')),
    ...dimensions(bytes, type)
  };
}

async function uploadPicture(request, env, identity, productId) {
  if (!env.PRODUCT_IMAGES) return json({ ok: false, error: 'R2 image storage is not enabled for this Worker yet.' }, 503);
  const product = await productExists(env.DB, productId);
  if (!product) return json({ ok: false, error: 'Product not found.' }, 404);
  let upload;
  try { upload = await parseUpload(request); } catch (error) { return json({ ok: false, error: 'The upload could not be read.' }, 400); }
  if (upload.error) return json({ ok: false, error: upload.error }, 400);

  let replaced = null;
  if (upload.replacePictureId) {
    replaced = await env.DB.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ? AND active = 1').bind(upload.replacePictureId, productId).first();
    if (!replaced) return json({ ok: false, error: 'The picture to replace was not found.' }, 404);
  }

  const key = `products/${productId}/${crypto.randomUUID()}.${upload.extension}`;
  await env.PRODUCT_IMAGES.put(key, upload.bytes, {
    httpMetadata: { contentType: upload.type, cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { productId, uploadedBy: identity.email }
  });

  try {
    if (replaced) {
      await env.DB.prepare(`UPDATE product_images SET object_key = ?, delivery_url = ?, mime_type = ?, file_size = ?,
        width = ?, height = ?, alt_text = ?, variant_style = ?, uploaded_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND product_id = ? AND active = 1`)
        .bind(key, `/product-images/${replaced.id}`, upload.type, upload.file.size, upload.width, upload.height,
          upload.altText || replaced.alt_text || product.name, upload.variantStyle, identity.email, replaced.id, productId).run();
      await audit(env.DB, identity, 'replace', replaced.id, `Replaced picture for ${product.name}`);
      if (replaced.object_key) await env.PRODUCT_IMAGES.delete(replaced.object_key);
    } else {
      const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value, COUNT(*) AS count FROM product_images WHERE product_id = ? AND active = 1').bind(productId).first();
      const result = await env.DB.prepare(`INSERT INTO product_images
        (product_id, path, object_key, delivery_url, mime_type, file_size, width, height, alt_text, sort_order, is_primary, active, uploaded_by, variant_style)
        VALUES (?, '', ?, '', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(productId, key, upload.type, upload.file.size, upload.width, upload.height,
          upload.altText || product.name, Number(max?.value || 0) + 1, Number(max?.count || 0) === 0 ? 1 : 0, identity.email, upload.variantStyle).run();
      const id = Number(result.meta.last_row_id);
      await env.DB.prepare('UPDATE product_images SET delivery_url = ? WHERE id = ?').bind(`/product-images/${id}`, id).run();
      await audit(env.DB, identity, 'upload', id, `Uploaded picture for ${product.name}`);
    }
  } catch (error) {
    await env.PRODUCT_IMAGES.delete(key);
    throw error;
  }
  return json({ ok: true, pictures: await listProductPictures(env.DB, productId) }, replaced ? 200 : 201);
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
  return json({ ok: true, pictures: await listProductPictures(env.DB, picture.product_id) });
}

export async function serveProductPicture(request, env, pictureId) {
  if (!env.DB || !env.PRODUCT_IMAGES) return new Response('Not found', { status: 404 });
  const picture = await env.DB.prepare('SELECT object_key, mime_type FROM product_images WHERE id = ? AND active = 1 AND object_key != ?').bind(pictureId, '').first();
  if (!picture) return new Response('Not found', { status: 404 });
  const object = await env.PRODUCT_IMAGES.get(picture.object_key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', picture.mime_type || headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
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
