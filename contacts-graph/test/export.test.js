import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserClasses } from './helpers/load-app.js';

const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk';

function contact(overrides) {
  return { id: 'c_' + Math.random(), fn: 'Contact', ...overrides };
}

test('serializeBundle externalizes a photo to a filename + image entry', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const { markdown, images } = md.serializeBundle([contact({ fn: 'Jane Doe', photo: JPG })]);

  assert.equal(images.length, 1);
  assert.equal(images[0].name, 'jane-doe.jpg'); // human-readable slug, jpeg → .jpg
  assert.equal(images[0].dataUrl, JPG);
  // frontmatter references the file, not the inline data URL
  assert.match(markdown, /photo: jane-doe\.jpg/);
  assert.doesNotMatch(markdown, /data:image/);
});

test('serializeBundle leaves photo-free contacts as a plain document', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const { markdown, images } = md.serializeBundle([contact({ fn: 'No Photo' })]);
  assert.equal(images.length, 0);
  assert.match(markdown, /fn: No Photo/);
});

test('bundle image filenames are unique for duplicate names', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const { images } = md.serializeBundle([
    contact({ fn: 'Same Name', photo: JPG }),
    contact({ fn: 'Same Name', photo: JPG }),
  ]);
  assert.deepEqual(
    images.map((i) => i.name),
    ['same-name.jpg', 'same-name-2.jpg'],
  );
});

test('different photo formats get the right extension', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const { images } = md.serializeBundle([contact({ fn: 'Png Person', photo: PNG })]);
  assert.equal(images[0].name, 'png-person.png');
});

test('a single contact bundle shares the base name between .md and image', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();
  const c = contact({ fn: 'Dr. Jane, Q. Doe;Smith', photo: JPG });
  const slug = md._slugFor(c);
  const { images } = md.serializeBundle([c]);
  assert.equal(slug, 'dr-jane-q-doe-smith');
  assert.equal(images[0].name, `${slug}.jpg`);
});

test('import keeps embedded data-URL photos but drops externalized filename refs', () => {
  const { MarkdownAdapter } = loadBrowserClasses();
  const md = new MarkdownAdapter();

  const embedded = md.parse(`---\nuid: a\nfn: Embedded\nphoto: ${JPG}\n---\nbody`)[0];
  assert.equal(embedded.photo, JPG);

  const referenced = md.parse('---\nuid: b\nfn: Referenced\nphoto: embedded.jpg\n---\nbody')[0];
  assert.equal(referenced.photo, null); // filename ref with no inline data → dropped (no broken image)
});
