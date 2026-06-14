import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import {
  Ingredient,
  IngredientSchema,
} from '../src/database/schemas/ingredient.schema';
import {
  IngredientsCategory,
  ingredinatsCategorySchema,
} from '../src/database/schemas/ingredinats.Category.schema';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

type ExportRow = {
  Category: string;
  'Ingredient Name': string;
};

function parseOutPath(argv: string[]): string {
  const outFlagIndex = argv.findIndex((arg) => arg === '--out' || arg === '-o');
  if (outFlagIndex !== -1 && argv[outFlagIndex + 1]) {
    return path.resolve(argv[outFlagIndex + 1]);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.resolve(__dirname, `../exports/ingredients-${timestamp}.xlsx`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';

  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  const outPath = parseOutPath(process.argv.slice(2));

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB');

  const CategoryModel = mongoose.model(
    IngredientsCategory.name,
    ingredinatsCategorySchema,
  );
  const IngredientModel = mongoose.model(Ingredient.name, IngredientSchema);

  const categories = await CategoryModel.find({}, { name: 1 }).lean();
  const categoryById = new Map(
    categories.map((category) => [String(category._id), category.name]),
  );

  const ingredients = await IngredientModel.find({}, { name: 1, categoryId: 1 })
    .sort({ name: 1 })
    .lean();

  const rows: ExportRow[] = ingredients.map((ingredient) => ({
    Category: categoryById.get(String(ingredient.categoryId)) ?? 'Unknown',
    'Ingredient Name': ingredient.name,
  }));

  rows.sort((a, b) => {
    const categoryCompare = a.Category.localeCompare(b.Category);
    if (categoryCompare !== 0) return categoryCompare;
    return a['Ingredient Name'].localeCompare(b['Ingredient Name']);
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['Category', 'Ingredient Name'],
  });
  worksheet['!cols'] = [{ wch: 28 }, { wch: 40 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ingredients');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(workbook, outPath);

  console.log(`Exported ${rows.length} ingredients to ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
