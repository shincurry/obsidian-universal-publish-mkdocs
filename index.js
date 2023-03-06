const express = require('express');
const multer  = require('multer')
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const shell = require('shelljs');
const JSZip = require("jszip");
const cors = require('cors');

const app = express()
const host = process.env.HOST || "127.0.0.1"
const port = process.env.PORT || 9001

const MKDOCS_CONFIG_PATH = process.env.MKDOCS_CONFIG_PATH
const MKDOCS_BASE_DOCS_PATH = process.env.MKDOCS_BASE_DOCS_PATH
if (!MKDOCS_CONFIG_PATH) {
  throw new Error("MKDOCS_CONFIG_PATH not set.")
}
if (!fs.lstatSync(MKDOCS_CONFIG_PATH).isFile()) {
  throw new Error("MKDOCS_CONFIG_PATH is not file.")
}
if (MKDOCS_BASE_DOCS_PATH && !fs.lstatSync(MKDOCS_BASE_DOCS_PATH).isDirectory()) {
  throw new Error("MKDOCS_BASE_DOCS_PATH is not directory.")
}

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip') return cb(null, true);
    return cb(null, false);
  },
});

app.use(cors())

app.post('/generate', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('require file')
  }

  const publishId = uuidv4();
  const tmpDir = path.join(__dirname, "./tmp");
  const publishDir = path.join(tmpDir, publishId);
  const distDir = path.join(publishDir, 'dist');
  try {

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir);
    }

    fs.mkdirSync(publishDir);

    if (MKDOCS_CONFIG_PATH) {
      if (fs.lstatSync(MKDOCS_CONFIG_PATH).isFile()) {
        fs.cpSync(MKDOCS_CONFIG_PATH, path.join(publishDir, 'mkdocs.yml'))
      }
    }
    fs.mkdirSync(path.join(publishDir, 'docs'))
    if (MKDOCS_BASE_DOCS_PATH) {
      if (fs.lstatSync(MKDOCS_BASE_DOCS_PATH).isDirectory()) {
        const files = fs.readdirSync(MKDOCS_BASE_DOCS_PATH)
        for (const file of files) {
          fs.cpSync(path.join(MKDOCS_BASE_DOCS_PATH, file), path.join(publishDir, 'docs', file), {
            recursive: true,
          })
        }
      }
    }

    const sourceZip = await JSZip.loadAsync(req.file.buffer);
    for (const filename in sourceZip.files) {
      if (sourceZip.files[filename].dir) continue
      const buffer = await sourceZip.files[filename].async('nodebuffer')
      const outputFilePath = path.join(publishDir, 'docs', filename)
      const outputDirPath = path.dirname(outputFilePath)
      await fs.mkdirp(outputDirPath)
      await fs.writeFile(outputFilePath, buffer)
    }

    shell.exec(`ls ${path.join(publishDir, 'docs')}`)
    const command = `cd ${publishDir} && mkdocs build -d ${distDir} -c`;
    shell.exec(command);

    const websiteZip = new JSZip();
    await jszipLoadFolderFiles(websiteZip, distDir)
    const websiteZipData = await websiteZip.generateAsync({ type: 'nodebuffer' })

    fs.rmSync(publishDir, { recursive: true, force: true });

    return res.status(200).send(websiteZipData)
  } catch (error) {
    console.error(error)
    fs.rmSync(publishDir, { recursive: true, force: true });
    return res.status(400).send("failed");
  }
})

app.listen(port, host, () => {
  console.log(`App listening on port ${host}:${port}`)
})

async function jszipLoadFolderFiles(zip, folder) {
  const helper = async (_path) => {
    const filestst = await fs.lstat(_path)
    if (filestst.isSymbolicLink()) return
    if (filestst.isDirectory()) {
      const files = await fs.readdir(_path)
      for (const file of files) {
        await helper(path.join(_path, file))
      }
    } else {
      const zipPath = path.relative(folder, _path)
      const buffer = await fs.readFile(_path)
      await zip.file(zipPath, buffer)
    }
  }
  await helper(folder)
}