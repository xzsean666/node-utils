import { authenticator } from "otplib";
import * as qrcode from "qrcode";

class OTPUtils {
  secret: string;
  constructor(secret: string) {
    this.secret = secret;
  }

  async newSecret(user: string, service: string) {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user, service, secret);
    const imageUrl = await qrcode.toDataURL(otpauth);
    const result = {
      secret: secret,
      otpauth: otpauth,
      imageUrl: imageUrl,
    };
    return result;
  }
  timer() {
    return authenticator.timeRemaining();
  }
  getToken() {
    const token = authenticator.generate(this.secret);
    return token;
  }
}

export default OTPUtils;
