import sharp from 'sharp'
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]] as const) {
  await sharp('public/favicon.svg').resize(size, size).png().toFile(`public/${name}`)
}
