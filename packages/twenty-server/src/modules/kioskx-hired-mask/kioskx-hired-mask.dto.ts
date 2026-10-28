import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@ObjectType()
export class KioskxDeskText {
  @Field() kind: string;
  @Field() text: string;
}

@ObjectType()
export class KioskxDeskContact {
  @Field()
  unavailable: boolean;
  @Field() hasEmail: boolean;
  @Field() hasPhone: boolean;
  @Field() emailAvailable: boolean;
  @Field() callAvailable: boolean;
  @Field(() => [KioskxDeskText]) entries: KioskxDeskText[];
}

@ObjectType()
export class KioskxDeskResult {
  @Field() ok: boolean;
  @Field() status: string;
}

@InputType()
export class KioskxDeskActionInput {
  @Field() @IsUUID() personId: string;
  @Field() @IsUUID() requestId: string;
  @Field() @IsIn(['email', 'call']) action: 'email' | 'call';
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  body?: string;
}
