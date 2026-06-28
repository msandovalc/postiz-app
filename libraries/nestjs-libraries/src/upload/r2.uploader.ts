import {
  UploadPartCommand,
  S3Client,
  ListPartsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

const ALLOWED_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
};

function normalizeExtension(filename: string): string | null {
  const ext = path.extname(filename || '').toLowerCase();
  return ALLOWED_EXT_TO_MIME[ext] ? ext : null;
}

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY,
  CLOUDFLARE_BUCKETNAME,
  CLOUDFLARE_BUCKET_URL,
} = process.env;

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: CLOUDFLARE_ACCESS_KEY!,
    secretAccessKey: CLOUDFLARE_SECRET_ACCESS_KEY!,
  },
});

// Function to generate a random string
function generateRandomString() {
  return makeId(20);
}

// 1. Root-level log: This will trigger the exact moment you press SAVE (CTRL+S) if hot-reload is working.
console.log('🔥 MAITE HMR TEST: The file has been hot-reloaded! I am ready for your requests.');

export default async function handleR2Upload(
  endpoint: string,
  req: Request,
  res: Response
) {

  // 2. Request-level log: This will trigger every time the frontend hits this route.
  console.log(`💋 MAITE API ROUTER: Incoming request for endpoint -> [${endpoint}]`);

  switch (endpoint) {
    case 'create-multipart-upload':
      return createMultipartUpload(req, res);
    case 'prepare-upload-parts':
      return prepareUploadParts(req, res);
    case 'complete-multipart-upload':
      return completeMultipartUpload(req, res);
    case 'list-parts':
      return listParts(req, res);
    case 'abort-multipart-upload':
      return abortMultipartUpload(req, res);
    case 'sign-part':
      return signPart(req, res);
  }
  return res.status(404).end();
}

export async function simpleUpload(
  data: Buffer,
  originalFilename: string,
  _contentType: string
) {
  const detected = await fromBuffer(data);
  if (!detected || !Object.values(ALLOWED_EXT_TO_MIME).includes(detected.mime)) {
    throw new Error('Unsupported file type.');
  }
  const fileExtension = `.${detected.ext}`;
  const safeContentType = detected.mime;
  const randomFilename = generateRandomString() + fileExtension;

  const params = {
    Bucket: CLOUDFLARE_BUCKETNAME,
    Key: randomFilename,
    Body: data,
    ContentType: safeContentType,
  };

  const command = new PutObjectCommand({ ...params });
  await R2.send(command);

  return CLOUDFLARE_BUCKET_URL + '/' + randomFilename;
}

export async function createMultipartUpload(req: Request, res: Response) {
  // Support both Uppy's default payload { filename } and custom payload { file: { name } }
  const incomingFilename = req.body.filename || req.body.file?.name || '';
  const fileHash = req.body.fileHash || '';

  const safeExt = normalizeExtension(incomingFilename);

  if (!safeExt) {
    console.error('Validation Error: Missing or unsupported file type for:', incomingFilename);
    return res.status(400).json({ message: 'Unsupported file type or missing filename.' });
  }

  const safeContentType = ALLOWED_EXT_TO_MIME[safeExt];
  const randomFilename = generateRandomString() + safeExt;

  console.log(`[Multipart Create] Ext: ${safeExt} | Key: ${randomFilename}`);

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: `${randomFilename}`,
      ContentType: safeContentType,
      Metadata: {
        'file-hash': fileHash,
      },
    };

    const command = new CreateMultipartUploadCommand(params);
    const response = await R2.send(command);

    return res.status(200).json({
      uploadId: response.UploadId,
      key: response.Key,
    });
  } catch (err) {
    // Detailed error logging to expose the hidden 500 issue with Cloudflare R2
    console.error('🔥 [CRITICAL] Failed at createMultipartUpload:');
    console.error('Error message:', err instanceof Error ? err.message : err);
    console.error('Stack trace:', err instanceof Error ? err.stack : 'No stack trace available');
    console.error('Credentials and Environment Variables Check:');
    console.error(`Bucket: ${CLOUDFLARE_BUCKETNAME}`);
    console.error(`Endpoint: https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    console.error('AccessKey present:', !!CLOUDFLARE_ACCESS_KEY);
    console.error('SecretKey present:', !!CLOUDFLARE_SECRET_ACCESS_KEY);

    return res.status(500).json({ error: 'Failed to initialize multipart upload.' });
  }
}

export async function prepareUploadParts(req: Request, res: Response) {
  const { partData } = req.body;

  const parts = partData.parts;

  const response = {
    presignedUrls: {},
  };

  for (const part of parts) {
    try {
      const params = {
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: partData.key,
        PartNumber: part.number,
        UploadId: partData.uploadId,
      };
      const command = new UploadPartCommand({ ...params });
      const url = await getSignedUrl(R2, command, { expiresIn: 3600 });

      // @ts-ignore
      response.presignedUrls[part.number] = url;
    } catch (err) {
      console.log('Error', err);
      return res.status(500).json(err);
    }
  }

  return res.status(200).json(response);
}

export async function listParts(req: Request, res: Response) {
  const { key, uploadId } = req.body;

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
    };
    const command = new ListPartsCommand({ ...params });
    const response = await R2.send(command);

    return res.status(200).json(response['Parts']);
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json(err);
  }
}

export async function createMultipartUpload(req: Request, res: Response) {
  // Support both Uppy's default payload { filename } and custom payload { file: { name } }
  const incomingFilename = req.body.filename || req.body.file?.name || '';
  const fileHash = req.body.fileHash || '';

  const safeExt = normalizeExtension(incomingFilename);

  if (!safeExt) {
    console.error('Validation Error: Missing or unsupported file type for:', incomingFilename);
    return res.status(400).json({ message: 'Unsupported file type or missing filename.' });
  }

  const safeContentType = ALLOWED_EXT_TO_MIME[safeExt];
  const randomFilename = generateRandomString() + safeExt;

  console.log(`[Multipart Create] Ext: ${safeExt} | Key: ${randomFilename}`);

  try {
    const params: any = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: `${randomFilename}`,
      ContentType: safeContentType,
    };

    // FIX: Cloudflare rejects empty metadata headers. Only attach if a valid hash is provided.
    if (fileHash && fileHash.trim() !== '') {
      params.Metadata = {
        'file-hash': fileHash,
      };
    }

    const command = new CreateMultipartUploadCommand(params);
    const response = await R2.send(command);

    return res.status(200).json({
      uploadId: response.UploadId,
      key: response.Key,
    });
  } catch (err: any) {
    // Aggressive error logging to expose the hidden 500 issue with Cloudflare R2
    console.error('\n❌❌❌ [CRITICAL] CLOUDFLARE R2 REJECTED THE REQUEST ❌❌❌');
    console.error('👉 AWS Error Name:', err.name || 'Unknown');
    console.error('👉 AWS Error Message:', err.message || 'No message available');
    console.error('👉 HTTP Status Code:', err.$metadata?.httpStatusCode || 'N/A');
    console.error('👉 Request ID:', err.$metadata?.requestId || 'N/A');

    console.error('\n🔍 Credentials Check (Ensure there are no trailing spaces):');
    console.error(`Bucket: [${CLOUDFLARE_BUCKETNAME}]`);
    console.error(`AccessKey: [${CLOUDFLARE_ACCESS_KEY}]`);
    console.error(`Endpoint: [https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com]`);
    console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌\n');

    return res.status(500).json({ error: 'Failed to initialize multipart upload.', details: err.name });
  }
}

export async function abortMultipartUpload(req: Request, res: Response) {
  const { key, uploadId } = req.body;

  if (!key || !uploadId) {
    console.log('💋 MAITE: Ignoring abort request because Key or UploadId is missing.');
    return res.status(400).json({ message: 'Nothing to abort.' });
  }

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
    };
    const command = new AbortMultipartUploadCommand({ ...params });
    const response = await R2.send(command);

    return res.status(200).json(response);
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json(err);
  }
}

export async function signPart(req: Request, res: Response) {
  // 1. Destructure with extra validation to ensure we don't crash on bad payloads
  const { key, uploadId } = req.body;
  const partNumber = parseInt(req.body.partNumber, 10);

  // 2. Strict validation: Reject immediately if the request is malformed
  if (!key || typeof key !== 'string' || !uploadId || typeof uploadId !== 'string' || isNaN(partNumber)) {
    console.error('❌ MAITE ERROR: signPart called with invalid parameters', { key, uploadId, partNumber });
    return res.status(400).json({
      message: 'Invalid or missing key, uploadId, or partNumber.'
    });
  }

  // 3. Tactical logs: Seeing what we are dealing with before the sign process
  console.log(`🔍 MAITE DEBUG signPart: Requesting signed URL | Part: ${partNumber} | Key: ${key} | UploadId: ${uploadId.substring(0, 15)}...`);

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
    };

    const command = new UploadPartCommand(params);

    // 4. Generate the presigned URL with the S3 client
    const url = await getSignedUrl(R2, command, { expiresIn: 3600 });

    // 5. Success log: Confirm the signature was generated
    console.log(`✅ MAITE SUCCESS: Signed URL generated successfully for part ${partNumber}`);

    return res.status(200).json({
      url: url,
    });
  } catch (err: any) {
    // 6. Deep error logging: Capture exactly why R2/AWS SDK refused to sign this part
    console.error('❌ MAITE CRITICAL: Failed to sign upload part:', {
      message: err.message,
      name: err.name,
      partNumber,
      key
    });

    return res.status(500).json({
      message: 'Failed to sign upload part',
      error: err.message
    });
  }
}