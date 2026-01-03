import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UserService } from '../modules/user/user.service';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../database/schemas/user.auth.schema';

async function seedAdmin() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const userService = app.get(UserService);

  const adminEmail = process.env.ADMIN_EMAIL || 'aniketsubudhi00@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const adminName = process.env.ADMIN_NAME || 'Super Admin';

  try {
    const existingAdmin = await userService.findByEmail(adminEmail);

    if (existingAdmin) {
      console.log(`Admin user already exists with email: ${adminEmail}`);
      await app.close();
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const admin = await userService.create({
      email: adminEmail,
      passwordHash,
      name: adminName,
      role: UserRole.ADMIN,
    });

    console.log('Admin user created successfully!');
   
    console.log(`\n Default password: ${adminPassword}`);
    console.log('Please change the password after first login!\n');
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    throw error;
  } finally {
    await app.close();
  }
}

seedAdmin()
  .then(() => {
    console.log('Seed completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
