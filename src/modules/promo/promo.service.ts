import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PromoCard,
  PromoCardDocument,
  PromoPlatform,
} from '../../database/schemas/promo-card.schema';
import {
  PerksMembership,
  PerksMembershipDocument,
  PerksMembershipPlan,
  PerksMembershipStatus,
} from '../../database/schemas/perks-membership.schema';
import { User, UserDocument } from '../../database/schemas/user.auth.schema';
import { ImageUploadService } from '../image-upload/image-upload.service';
import { DataVersionService } from '../data-version/data-version.service';
import { CreatePromoDto } from './dto/create-promo.dto';
import { UpdatePromoDto } from './dto/update-promo.dto';
import { PromoViewerContext, selectWinningCards } from './promo-audience';

const PROMO_IMAGE_FOLDER = 'promo-cards';

@Injectable()
export class PromoService {
  private readonly logger = new Logger(PromoService.name);

  constructor(
    @InjectModel(PromoCard.name)
    private readonly promoModel: Model<PromoCardDocument>,
    @InjectModel(PerksMembership.name)
    private readonly membershipModel: Model<PerksMembershipDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly imageUploadService: ImageUploadService,
    private readonly dataVersionService: DataVersionService,
  ) {}

  /**
   * Returns every card the caller qualifies for, at most one per placement.
   *
   * Deliberately fetches all active cards and filters in `selectWinningCards`
   * rather than translating the audience rules into a Mongo query: the
   * collection is small (tens of documents), and one implementation of the
   * "empty array means any" rule is far easier to keep correct than two.
   */
  async findForViewer(
    userId: string | null,
    platform: PromoPlatform | null,
    appVersion: string | null,
  ): Promise<PromoCard[]> {
    const [viewer, cards] = await Promise.all([
      this.buildViewerContext(userId, platform, appVersion),
      this.promoModel.find({ isActive: true }).lean<PromoCard[]>().exec(),
    ]);

    return selectWinningCards(cards, viewer);
  }

  /**
   * Anonymous callers resolve to a non-member with no plan or country, which is
   * exactly the audience the design's non-member variant targets.
   */
  private async buildViewerContext(
    userId: string | null,
    platform: PromoPlatform | null,
    appVersion: string | null,
  ): Promise<PromoViewerContext> {
    const base = {
      platform,
      appVersion,
      now: new Date(),
    };

    if (!userId || !Types.ObjectId.isValid(userId)) {
      return { ...base, isMember: false, plan: null, country: null };
    }

    try {
      const [membership, user] = await Promise.all([
        this.membershipModel
          .findOne({ userId: new Types.ObjectId(userId) })
          .select('status plan')
          .lean<{ status: PerksMembershipStatus; plan: PerksMembershipPlan }>()
          .exec(),
        this.userModel
          .findById(userId)
          .select('country')
          .lean<{ country?: string }>()
          .exec(),
      ]);

      return {
        ...base,
        isMember: membership?.status === PerksMembershipStatus.ACTIVE,
        plan: membership?.plan ?? null,
        country: user?.country ?? null,
      };
    } catch (error) {
      // A promo is never worth failing a screen over: degrade to the
      // non-member audience rather than throwing.
      this.logger.warn(
        `Failed to resolve promo viewer context for ${userId}: ${this.message(error)}`,
      );
      return { ...base, isMember: false, plan: null, country: null };
    }
  }

  async currentVersion(): Promise<number> {
    return this.dataVersionService.getVersion('promoCards');
  }

  // ---------------------------------------------------------------- admin

  async findAll(): Promise<PromoCard[]> {
    return this.promoModel
      .find()
      .sort({ placement: 1, priority: -1, updatedAt: -1 })
      .lean<PromoCard[]>()
      .exec();
  }

  async findById(id: string): Promise<PromoCard> {
    const card = await this.promoModel.findById(id).lean<PromoCard>().exec();
    if (!card) throw new NotFoundException('Promo card not found');
    return card;
  }

  async create(dto: CreatePromoDto): Promise<PromoCard> {
    const created = await new this.promoModel(this.toPersistable(dto)).save();
    await this.bump();
    return created.toObject();
  }

  async update(id: string, dto: UpdatePromoDto): Promise<PromoCard> {
    const updated = await this.promoModel
      .findByIdAndUpdate(id, { $set: this.toPersistable(dto) }, { new: true })
      .lean<PromoCard>()
      .exec();
    if (!updated) throw new NotFoundException('Promo card not found');
    await this.bump();
    return updated;
  }

  async toggleActive(id: string): Promise<PromoCard> {
    const card = await this.promoModel.findById(id).exec();
    if (!card) throw new NotFoundException('Promo card not found');

    card.isActive = !card.isActive;
    await card.save();
    await this.bump();
    return card.toObject();
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const card = await this.promoModel.findByIdAndDelete(id).lean<PromoCard>().exec();
    if (!card) throw new NotFoundException('Promo card not found');

    if (card.content?.image?.base) {
      // Best-effort: an orphaned S3 object is cheaper than a failed delete.
      await this.imageUploadService.deleteFile(card.content.image.base);
    }
    await this.bump();
    return { deleted: true };
  }

  /**
   * Uploaded separately from the card body so writes stay pure JSON — nested
   * DTOs do not survive multipart form encoding without hand-rolled parsing.
   * Returns the HeroImage descriptor for the admin to echo back on save.
   */
  async uploadImage(file: Express.Multer.File) {
    return this.imageUploadService.uploadImageWithVariants(
      file,
      PROMO_IMAGE_FOLDER,
    );
  }

  /**
   * Bridges the DTO to the persisted shape: schedule bounds arrive as ISO
   * strings (`@IsDateString`) but are stored as Dates, and countries are
   * matched case-insensitively so they are stored one way.
   */
  private toPersistable(
    dto: CreatePromoDto | UpdatePromoDto,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...dto };

    if (dto.audience) {
      payload.audience = {
        ...dto.audience,
        ...(dto.audience.countries
          ? {
              countries: dto.audience.countries.map((code) =>
                code.trim().toUpperCase(),
              ),
            }
          : {}),
      };
    }

    if (dto.schedule) {
      payload.schedule = {
        startsAt: dto.schedule.startsAt ? new Date(dto.schedule.startsAt) : null,
        endsAt: dto.schedule.endsAt ? new Date(dto.schedule.endsAt) : null,
      };
    }

    return payload;
  }

  private async bump() {
    await this.dataVersionService.bump('promoCards');
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
