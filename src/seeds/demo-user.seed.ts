import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'USER' },
    stateCode: String,
    country: String,
    pincode: String,
    dietaryProfile: {
      vegType: { type: String, default: 'OMNI' },
      dairyFree: { type: Boolean, default: false },
      nutFree: { type: Boolean, default: false },
      glutenFree: { type: Boolean, default: false },
      hasDiabetes: { type: Boolean, default: false },
      otherAllergies: { type: [String], default: [] },
      tastePrefrence: { type: [String], default: [] },
      noOfAdults: { type: Number, default: 0 },
      noOfChildren: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

async function seedDemoUser() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';

  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB');

  const UserModel = mongoose.model('User', UserSchema);

  const email = 'bed@abednarz.net';
  const plainPassword = 'test1234';

  const existing = await UserModel.findOne({ email });
  if (existing) {
    console.log(`Demo user already exists with email: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(plainPassword, 10);

  await UserModel.create({
    email,
    passwordHash,
    name: 'Saneev Kumar Das',
    role: 'USER',
    stateCode: 'IN-DL',
    country: 'India',
    dietaryProfile: {
      vegType: 'OMNI',
      dairyFree: false,
      nutFree: false,
      glutenFree: false,
      hasDiabetes: false,
      otherAllergies: [],
      tastePrefrence: [],
      noOfAdults: 2,
      noOfChildren: 0,
    },
  });

  console.log(`Demo user created: ${email} / ${plainPassword}`);
}

seedDemoUser()
  .then(() => {
    console.log('Seed completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
