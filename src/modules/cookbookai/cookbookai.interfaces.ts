export interface CookbookaiJobData {
  type: 'extract-recipe' | 'generate-from-ingredients';
  userId: string;
  message: string;
  recipeId?: string;
  ingredients?: string[];
  preference?: string;
}
