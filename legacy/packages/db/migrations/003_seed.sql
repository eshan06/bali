-- MVP seed data: one school + default blocked apps
INSERT INTO schools (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Demo School', 'demo-school')
ON CONFLICT DO NOTHING;

INSERT INTO blocking_apps (school_id, bundle_id, app_name, category, is_default)
SELECT * FROM (VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.burbn.instagram', 'Instagram', 'Social Media', true),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.zhiliaoapp.musically', 'TikTok', 'Social Media', true),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.toyopagroup.picaboo', 'Snapchat', 'Social Media', true),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.facebook.Facebook', 'Facebook', 'Social Media', true),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.atebits.Tweetie2', 'Twitter/X', 'Social Media', true),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.google.ios.youtube', 'YouTube', 'Entertainment', true),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.netflix.Netflix', 'Netflix', 'Entertainment', false),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.spotify.client', 'Spotify', 'Entertainment', false),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.supercell.laser', 'Brawl Stars', 'Games', true),
  ('11111111-1111-1111-1111-111111111111'::uuid, 'com.innersloth.amongus', 'Among Us', 'Games', true)
) AS v(school_id, bundle_id, app_name, category, is_default)
WHERE NOT EXISTS (SELECT 1 FROM blocking_apps WHERE school_id = '11111111-1111-1111-1111-111111111111');
