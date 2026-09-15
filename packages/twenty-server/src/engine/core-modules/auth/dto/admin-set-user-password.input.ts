import { ArgsType, Field } from '@nestjs/graphql';

import { IsEmail, IsNotEmpty, Length } from 'class-validator';

@ArgsType()
export class AdminSetUserPasswordInput {
  @Field(() => String)
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @Field(() => String)
  @IsNotEmpty()
  @Length(8, 50)
  newPassword: string;
}
