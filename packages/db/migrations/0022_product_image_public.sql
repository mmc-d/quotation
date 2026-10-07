-- Product photos are catalogue images shown on customer quotes (public page + PDF). A narrow
-- SECURITY DEFINER lookup returns the tenant only for a file that is some product's image.
CREATE OR REPLACE FUNCTION tenant_for_product_image(fid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM product WHERE image_file_id = fid LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_for_product_image(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_for_product_image(uuid) TO mmc_app;
