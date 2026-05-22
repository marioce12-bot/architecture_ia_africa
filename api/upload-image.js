export const config = {
  api: {
    bodyParser: false
  }
};

const FIREBASE_PROJECT_ID = 'omni-98377';

async function getSignedInUser(idToken) {
  const lookupResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({idToken})
    }
  );
  const lookupData = await lookupResponse.json();
  if (!lookupResponse.ok || !lookupData.users?.[0]?.localId) return null;
  return {uid: lookupData.users[0].localId, email: lookupData.users[0].email || ''};
}

async function isAdmin(uid, idToken) {
  const docResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/architecture_ia_africa_admins/${uid}`,
    {headers: {Authorization: `Bearer ${idToken}`}}
  );
  return docResponse.ok;
}

async function parseMultipartImage(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error('Boundary multipart manquant');

  const body = buffer.toString('binary');
  const parts = body.split('--' + boundary);
  const imagePart = parts.find(part => part.includes('name="image"'));
  if (!imagePart) throw new Error('Image manquante');

  const start = imagePart.indexOf('\r\n\r\n');
  if (start === -1) throw new Error('Image invalide');
  const binary = imagePart.slice(start + 4).replace(/\r\n$/, '');
  return Buffer.from(binary, 'binary');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({error: 'Méthode non autorisée'});
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const user = await getSignedInUser(idToken);
    if (!user) {
      res.status(401).json({error: 'Non connecté'});
      return;
    }

    if (!(await isAdmin(user.uid, idToken))) {
      res.status(403).json({error: 'Compte non autorisé'});
      return;
    }

    if (!process.env.IMGBB_API_KEY) {
      res.status(500).json({error: 'Clé ImgBB serveur manquante'});
      return;
    }

    const imageBuffer = await parseMultipartImage(req);
    const imgbbForm = new FormData();
    imgbbForm.append('image', imageBuffer.toString('base64'));

    const uploadResponse = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
      method: 'POST',
      body: imgbbForm
    });
    const uploadData = await uploadResponse.json();

    if (!uploadResponse.ok || !uploadData.success) {
      res.status(502).json({error: 'Upload ImgBB impossible'});
      return;
    }

    res.status(200).json({url: uploadData.data.url});
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Erreur upload image'});
  }
}
