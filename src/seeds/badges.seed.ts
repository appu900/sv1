/**
 * Sample Badge Seeder
 * 
 * This file contains sample badges for different milestones and achievements.
 * You can run this seeder to populate your database with initial badge data.
 * 
 * To use:
 * 1. Create badge images and upload them to your storage
 * 2. Update the imageUrl fields with actual URLs
 * 3. Import and run this seeder in your main seeder file
 */

import { BadgeCategory, MilestoneType } from '../database/schemas/badge.schema';

export const sampleBadges = [
  // ============ MEAL COOKING MILESTONES ============
  {
    name: 'First Steps',
    description: 'Cooked your first meal! Welcome to the journey of reducing food waste.',
    imageUrl: '/badges/first-meal.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_MEALS_COOKED,
    milestoneThreshold: 1,
    rarityScore: 10,
    iconColor: '#FFD700',
    isActive: true,
  },
  {
    name: 'Getting Started',
    description: 'Cooked 5 meals! You\'re building great habits.',
    imageUrl: '/badges/5-meals.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_MEALS_COOKED,
    milestoneThreshold: 5,
    rarityScore: 20,
    iconColor: '#FFD700',
    isActive: true,
  },
  {
    name: 'Cooking Enthusiast',
    description: 'Cooked 10 meals! You\'re making a real difference.',
    imageUrl: '/badges/10-meals.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_MEALS_COOKED,
    milestoneThreshold: 10,
    rarityScore: 30,
    iconColor: '#FFD700',
    isActive: true,
  },
  {
    name: 'Kitchen Champion',
    description: 'Cooked 25 meals! You\'re a true champion of sustainability.',
    imageUrl: '/badges/25-meals.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_MEALS_COOKED,
    milestoneThreshold: 25,
    rarityScore: 50,
    iconColor: '#FF8C00',
    isActive: true,
  },
  {
    name: 'Master Chef',
    description: 'Cooked 50 meals! You\'re a master of reducing food waste.',
    imageUrl: '/badges/50-meals.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_MEALS_COOKED,
    milestoneThreshold: 50,
    rarityScore: 75,
    iconColor: '#FF8C00',
    isActive: true,
  },
  {
    name: 'Legendary Cook',
    description: 'Cooked 100 meals! You\'re a legend in the kitchen.',
    imageUrl: '/badges/100-meals.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_MEALS_COOKED,
    milestoneThreshold: 100,
    rarityScore: 100,
    iconColor: '#DC143C',
    isActive: true,
  },

  // ============ FOOD SAVED MILESTONES (in grams) ============
  {
    name: 'Waste Warrior',
    description: 'Saved 1kg of food from going to waste! Every bit counts.',
    imageUrl: '/badges/1kg-saved.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_FOOD_SAVED,
    milestoneThreshold: 1000, // 1kg in grams
    rarityScore: 20,
    iconColor: '#32CD32',
    isActive: true,
  },
  {
    name: 'Eco Hero',
    description: 'Saved 5kg of food! You\'re making a huge impact.',
    imageUrl: '/badges/5kg-saved.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_FOOD_SAVED,
    milestoneThreshold: 5000, // 5kg in grams
    rarityScore: 40,
    iconColor: '#32CD32',
    isActive: true,
  },
  {
    name: 'Sustainability Star',
    description: 'Saved 10kg of food! You\'re a shining example.',
    imageUrl: '/badges/10kg-saved.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_FOOD_SAVED,
    milestoneThreshold: 10000, // 10kg in grams
    rarityScore: 60,
    iconColor: '#228B22',
    isActive: true,
  },
  {
    name: 'Planet Protector',
    description: 'Saved 25kg of food! You\'re protecting our planet.',
    imageUrl: '/badges/25kg-saved.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_FOOD_SAVED,
    milestoneThreshold: 25000, // 25kg in grams
    rarityScore: 80,
    iconColor: '#228B22',
    isActive: true,
  },
  {
    name: 'Earth Guardian',
    description: 'Saved 50kg of food! You\'re a true guardian of Earth.',
    imageUrl: '/badges/50kg-saved.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.TOTAL_FOOD_SAVED,
    milestoneThreshold: 50000, // 50kg in grams
    rarityScore: 95,
    iconColor: '#006400',
    isActive: true,
  },

  // ============ MONTHLY MILESTONES ============
  {
    name: 'Monthly Achiever',
    description: 'Cooked 10 meals in a single month! Consistency is key.',
    imageUrl: '/badges/monthly-10.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.MONTHLY_MEALS_COOKED,
    milestoneThreshold: 10,
    rarityScore: 45,
    iconColor: '#4169E1',
    isActive: true,
  },
  {
    name: 'Monthly Champion',
    description: 'Cooked 20 meals in a single month! Outstanding dedication.',
    imageUrl: '/badges/monthly-20.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.MONTHLY_MEALS_COOKED,
    milestoneThreshold: 20,
    rarityScore: 70,
    iconColor: '#4169E1',
    isActive: true,
  },

  // ============ YEARLY MILESTONES ============
  {
    name: 'Year of Impact',
    description: 'Cooked 100 meals in a single year! A year well spent.',
    imageUrl: '/badges/yearly-100.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.YEARLY_MEALS_COOKED,
    milestoneThreshold: 100,
    rarityScore: 85,
    iconColor: '#9370DB',
    isActive: true,
  },
  {
    name: 'Annual Excellence',
    description: 'Cooked 200 meals in a single year! Truly exceptional.',
    imageUrl: '/badges/yearly-200.png',
    category: BadgeCategory.MILESTONE,
    milestoneType: MilestoneType.YEARLY_MEALS_COOKED,
    milestoneThreshold: 200,
    rarityScore: 98,
    iconColor: '#9370DB',
    isActive: true,
  },

  // ============ SPECIAL BADGES ============
  {
    name: 'Community Builder',
    description: 'Created your first community group! Bringing people together.',
    imageUrl: '/badges/community-builder.png',
    category: BadgeCategory.SPECIAL,
    rarityScore: 50,
    iconColor: '#FF69B4',
    isActive: true,
  },
  {
    name: 'Challenge Pioneer',
    description: 'Created your first community challenge! Leading by example.',
    imageUrl: '/badges/challenge-pioneer.png',
    category: BadgeCategory.SPECIAL,
    rarityScore: 55,
    iconColor: '#FF69B4',
    isActive: true,
  },
];

// Function to seed badges
export async function seedBadges(badgeModel: any) {
  try {
    // Clear existing badges (optional - remove if you want to keep existing)
    // await badgeModel.deleteMany({});

    // Insert sample badges
    const inserted = await badgeModel.insertMany(sampleBadges);
    console.log(`✅ Seeded ${inserted.length} badges successfully`);
    return inserted;
  } catch (error) {
    console.error('❌ Error seeding badges:', error);
    throw error;
  }
}
