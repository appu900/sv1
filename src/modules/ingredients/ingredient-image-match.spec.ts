import {
  buildNameIndex,
  candidateNames,
  isNumberedCopy,
  matchImageFile,
} from './ingredient-image-match';

const index = buildNameIndex([
  { id: 'almond', name: 'Almond' },
  { id: 'flaked', name: 'Flaked almonds' },
  { id: 'amla', name: 'Amla', aliases: ['Indian gooseberries'] },
  { id: 'ketjap', name: 'Kecap manis', aliases: ['ABC kecap manis'] },
  { id: 'chilli1', name: 'Chilli' },
  { id: 'chilli2', name: 'chilli' },
]);

describe('ingredient image matching', () => {
  it('builds candidate names from file names', () => {
    expect(candidateNames('Alma (Indian gooseberries) (2).png')).toEqual([
      'alma indian gooseberries 2',
      'alma indian gooseberries',
      'alma',
      'indian gooseberries',
    ]);
  });

  it('matches exact names and aliases', () => {
    expect(matchImageFile('Almond.png', index)).toEqual({ status: 'matched', id: 'almond', via: 'almond' });
    expect(matchImageFile('abc kecap manis.png', index)).toMatchObject({ status: 'matched', id: 'ketjap' });
  });

  it('ignores plurals and word order', () => {
    expect(matchImageFile('Almonds flaked.png', index)).toMatchObject({ status: 'matched', id: 'flaked' });
  });

  it('uses text inside or outside brackets', () => {
    expect(matchImageFile('Alma (Indian gooseberries) (2).png', index)).toMatchObject({
      status: 'matched',
      id: 'amla',
    });
  });

  it('reports ambiguous and unmatched files', () => {
    expect(matchImageFile('Chilli.png', index)).toMatchObject({ status: 'ambiguous' });
    expect(matchImageFile('Dragon fruit.png', index)).toEqual({ status: 'unmatched' });
  });

  it('spots numbered copies', () => {
    expect(isNumberedCopy('Alma (Indian gooseberries) (2).png')).toBe(true);
    expect(isNumberedCopy('Alma (Indian gooseberries).png')).toBe(false);
  });
});
