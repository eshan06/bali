import { describe, expect, it } from 'vitest';

import { awsUriEncode, presignV4, signV4 } from '../src/sigv4.js';

/*
 * AWS Signature Version 4 by hand (sigv4.ts), pinned to AWS's own published examples — the
 * Signature Version 4 test suite's get-vanilla, and S3's worked examples of a GET signed in its
 * headers and the same GET presigned — and to the AWS SDK's signer for a real Cognito call
 * (deck-storage.test.ts pins the deck bucket's own requests to it too).
 */

/** AWS's documented sample credentials, the Signature Version 4 test suite's. */
const SAMPLE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
/** The ones S3's worked examples sign with. */
const S3_SAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const S3_EXAMPLE = { method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt' };
const S3_SCOPE = { region: 'us-east-1', service: 's3' };
const S3_DAY = new Date('2013-05-24T00:00:00Z');

describe('signV4: signed in its headers', () => {
  it('signs AWS’s get-vanilla example as AWS publishes it', () => {
    const headers = signV4(
      { method: 'GET', host: 'example.amazonaws.com', path: '/', headers: {} },
      '',
      { region: 'us-east-1', service: 'service' },
      SAMPLE,
      new Date('2015-08-30T12:36:00Z'),
    );
    expect(headers).toEqual({
      'x-amz-date': '20150830T123600Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    });
  });

  it('signs a Cognito call as the AWS SDK’s own signer does', () => {
    // The signature @smithy/signature-v4 gave this very request when this was written.
    const headers = signV4(
      {
        method: 'POST',
        host: 'cognito-idp.us-east-1.amazonaws.com',
        path: '/',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSCognitoIdentityProviderService.AdminGetUser',
        },
      },
      JSON.stringify({
        UserPoolId: 'us-east-1_C55e0fhX8',
        Username: 'Google_110293847566123450987',
      }),
      { region: 'us-east-1', service: 'cognito-idp' },
      SAMPLE,
      new Date('2026-10-09T12:34:56.789Z'),
    );
    expect(headers).toEqual({
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.AdminGetUser',
      'x-amz-date': '20261009T123456Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261009/us-east-1/cognito-idp/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=f1426639d3f10aa0b90114226c6a85502bb3bbff893f6a826b5537bd3c8f38eb',
    });
  });

  it('signs S3’s GET Object example as S3’s documentation publishes it', () => {
    const headers = signV4(
      {
        ...S3_EXAMPLE,
        headers: {
          range: 'bytes=0-9',
          'x-amz-content-sha256':
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      },
      '',
      S3_SCOPE,
      S3_SAMPLE,
      S3_DAY,
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

describe('presignV4: signed in its URL', () => {
  it('presigns S3’s GET example as S3’s documentation publishes it, URL and all', () => {
    expect(presignV4({ ...S3_EXAMPLE, headers: {} }, S3_SCOPE, S3_SAMPLE, S3_DAY, 86_400)).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('signs its own query, in byte order, and binds each header it is given', () => {
    const presign = (length: string) =>
      new URL(
        presignV4(
          {
            ...S3_EXAMPLE,
            method: 'PUT',
            headers: { 'content-length': length, 'content-type': 'application/pdf' },
          },
          S3_SCOPE,
          S3_SAMPLE,
          S3_DAY,
          300,
          { 'response-cache-control': 'no-store' },
        ),
      );
    const url = presign('10');
    // Upper case sorts before lower; the signature comes last, outside what it signs.
    expect([...url.searchParams.keys()]).toEqual([
      'X-Amz-Algorithm',
      'X-Amz-Credential',
      'X-Amz-Date',
      'X-Amz-Expires',
      'X-Amz-SignedHeaders',
      'response-cache-control',
      'X-Amz-Signature',
    ]);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Signature')).not.toBe(
      presign('11').searchParams.get('X-Amz-Signature'),
    );
  });
});

describe('awsUriEncode', () => {
  it('leaves only A–Z, a–z, 0–9 and -_.~ as they are', () => {
    expect(awsUriEncode("AZaz09-_.~ !'()*/+=&é")).toBe(
      'AZaz09-_.~%20%21%27%28%29%2A%2F%2B%3D%26%C3%A9',
    );
  });
});
